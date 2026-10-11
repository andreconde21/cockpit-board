import { App, Notice, TFolder, requestUrl } from "obsidian";
import { cardIdOf } from "./agent/card-id";
import { boardLink } from "./agent/context";
import { parseLeadMinutes } from "./notifications";
import {
  addCancels, desiredReminders, hasPending, heldReminders, markCancelled, markPosted, mayCarryToken, ntfyTarget, parseState,
  planSync, sequenceId, snapshotCards, staleReminders, withUniqueIds,
  type NtfyState, type ReminderCard, type SyncPlan,
} from "./ntfy";
import type { CockpitBoardSettings } from "./types";
import { fmStr } from "./ui/dom-helpers.js";
import { getMarkdownFilesAt } from "./vault-helpers";

// What this device armed, still has to cancel, and the timed cards it last
// saw live in localStorage, not data.json: data.json syncs, and each device
// must remember its own posts across restarts so a reminder it armed before
// closing is still cancelled when the card changes.
const STORAGE_KEY = "cockpit-board-ntfy";

// Every device only posts what changed against its own record, so a device
// that starts with a vault Dropbox has not caught up on yet can put an old
// reminder back on the server (or bring back one another device cancelled),
// and the device that saw the change would not notice. Each device therefore
// re-sends its whole view every 30 minutes: posts replace by sequence ID and
// a repeated DELETE is harmless, so the fresher device wins again within
// half an hour, and the stale one corrects itself as soon as its vault syncs.
const REASSERT_MS = 30 * 60000;

/** Statuses after which the rest of a run would fail the same way. */
function isFatal(status: number): boolean {
  return status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
}

export class NtfyReminders {
  private state: NtfyState;
  // Runs one at a time; a settings change bumps the generation, which stops
  // a run in flight so it does not keep posting with the old settings.
  private chain: Promise<void> = Promise.resolve();
  private queued = false;
  private generation = 0;
  private lastOk = false;
  private lastReassertMs = Date.now();
  private warned = false;
  private authWarned = false;
  private httpWarned = false;

  constructor(private app: App, private settings: () => CockpitBoardSettings) {
    this.state = parseState(app.loadLocalStorage(STORAGE_KEY));
  }

  /** Bring the server in line with the cards; at most one run waits behind the current one. */
  sync(): Promise<void> {
    if (this.queued) return this.chain;
    this.queued = true;
    this.chain = this.chain
      .then(() => {
        this.queued = false;
        return this.syncOnce(this.generation);
      })
      .catch((e) => { console.warn("Cockpit Board: phone reminder sync failed", e); });
    return this.chain;
  }

  /** The ntfy settings changed: stop the run in flight and sync with the new ones. */
  settingsChanged(): Promise<void> {
    this.generation++;
    return this.sync();
  }

  /** True when this reminder is on the server as of this device's last, successful run. */
  isPushed(cardId: string, date: string, lead: number): boolean {
    const s = this.settings();
    if (!s.ntfyEnabled || !this.lastOk) return false;
    const armed = this.state.armed[sequenceId(cardId, date, lead)];
    return !!armed && armed.target === ntfyTarget(s.ntfyServer, s.ntfyTopic);
  }

  private async syncOnce(gen: number): Promise<void> {
    const s = this.settings();
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);
    this.lastOk = false;

    if (!s.ntfyEnabled) {
      // Off: the only requests are DELETEs that undo what this device armed,
      // retried until they go through. Nothing pending, nothing sent.
      if (!hasPending(this.state)) return;
      this.state.seen = {};
      await this.apply(planSync(this.state, [], "", nowSec, false), "", gen);
      return;
    }

    const target = ntfyTarget(s.ntfyServer, s.ntfyTopic);
    if (!target || !this.tokenOk(target)) return;
    // A missing tasks folder would read as "no cards" and cancel everything.
    if (!(this.app.vault.getAbstractFileByPath(s.folder) instanceof TFolder)) return;

    const { cards: read, unread } = this.cards(s);
    const cards = withUniqueIds(read);
    const leads = parseLeadMinutes(s.notifyLeadMinutes);
    const prev = this.state.seen;
    const desired = desiredReminders(cards, leads, now, s.ntfyArmHours);
    addCancels(this.state, staleReminders(prev, cards, desired, leads, now, s.ntfyArmHours, unread), target);
    this.state.seen = snapshotCards(cards, prev, unread);

    const reassert = now.getTime() - this.lastReassertMs >= REASSERT_MS;
    const plan = planSync(this.state, desired, target, nowSec, reassert, heldReminders(prev, unread, leads));
    this.lastOk = await this.apply(plan, target, gen);
    if (reassert && this.lastOk) this.lastReassertMs = now.getTime();
  }

  /** Settings button: an immediate message, to check server, topic and token. */
  async testPush(): Promise<void> {
    const s = this.settings();
    const target = ntfyTarget(s.ntfyServer, s.ntfyTopic);
    if (!target) {
      new Notice("Set the ntfy server (https://...) and topic first.");
      return;
    }
    if (!this.tokenOk(target, false)) {
      new Notice("The access token is only sent over https://. Use an https server address.", 10000);
      return;
    }
    const status = await this.request("POST", target, { Title: "Cockpit board", Tags: "bell" },
      "Test push from Cockpit board. Reminders will look like this.");
    if (status >= 200 && status < 300) new Notice("Test push sent. It should show on your phone now.");
    else if (status === 401 || status === 403) new Notice(`The ntfy server refused the push (HTTP ${status}). Check the token and that it may write to this topic.`, 10000);
    else if (status === 0) new Notice("Could not reach the ntfy server.");
    else new Notice(`Test push failed (HTTP ${status}).`);
  }

  /**
   * Deletes first, so a failing post never holds back a cancellation; stops
   * at the first error the rest would repeat, or when the settings changed.
   * True when everything went out.
   */
  private async apply(plan: SyncPlan, target: string, gen: number): Promise<boolean> {
    let ok = true;
    try {
      for (const d of plan.deletes) {
        if (gen !== this.generation) return false;
        if (!d.target) continue;
        const status = await this.request("DELETE", `${d.target}/${d.seqId}`, {});
        // 404: already gone (fired or cancelled elsewhere), which is the goal.
        const sent = (status >= 200 && status < 300) || status === 404;
        markCancelled(this.state, d.seqId, d.target, sent);
        if (!sent) {
          ok = false;
          this.report(status);
          if (isFatal(status)) return false;
        }
      }
      for (const r of plan.posts) {
        if (gen !== this.generation) return false;
        const status = await this.request("POST", target, {
          At: String(r.at),
          "X-Sequence-ID": r.seqId,
          Title: r.title,
          Click: r.click,
          Tags: "bell",
        }, r.body);
        if (status >= 200 && status < 300) markPosted(this.state, r, target);
        else {
          ok = false;
          this.report(status);
          if (isFatal(status)) return false;
        }
      }
      return ok;
    } finally {
      this.save();
    }
  }

  /** Timed cards, and the paths of files the metadata cache has not read yet. */
  private cards(s: CockpitBoardSettings): { cards: ReminderCard[]; unread: Set<string> } {
    const cards: ReminderCard[] = [];
    const unread = new Set<string>();
    for (const file of getMarkdownFilesAt(this.app, s.folder)) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        unread.add(file.path);
        continue;
      }
      const fm = cache.frontmatter;
      if (!fm || !fm.time || !fm.due) continue;
      cards.push({
        path: file.path,
        id: cardIdOf(this.app, file),
        title: fmStr(fm.title) || file.basename,
        project: fmStr(fm.project),
        status: fmStr(fm.status),
        due: fmStr(fm.due),
        time: fmStr(fm.time),
        click: boardLink(this.app, file),
      });
    }
    return { cards, unread };
  }

  /** A token is never sent over plain http; say so once instead of syncing. */
  private tokenOk(url: string, warn = true): boolean {
    if (!this.settings().ntfyToken.trim() || mayCarryToken(url)) return true;
    if (warn && !this.httpWarned) {
      this.httpWarned = true;
      new Notice("Cockpit board: phone reminders are paused, the ntfy token is only sent over https://.", 10000);
    }
    return false;
  }

  /** HTTP status, or 0 when the server could not be reached. */
  private async request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<number> {
    const token = this.settings().ntfyToken.trim();
    if (token && mayCarryToken(url)) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await requestUrl({ url, method, headers, body, contentType: "text/plain; charset=utf-8", throw: false });
      return res.status;
    } catch {
      return 0;
    }
  }

  /** Once per session each: a Notice for a refused token, a console line for the rest. */
  private report(status: number): void {
    if (status === 401 || status === 403) {
      if (this.authWarned) return;
      this.authWarned = true;
      new Notice(`Cockpit board: the ntfy server refused a phone reminder (HTTP ${status}). Check the ntfy token and topic in settings.`, 10000);
    } else if (!this.warned) {
      this.warned = true;
      console.warn(`Cockpit Board: ntfy request failed (${status ? `HTTP ${status}` : "network error"})`);
    }
  }

  private save(): void {
    this.app.saveLocalStorage(STORAGE_KEY, this.state);
  }
}
