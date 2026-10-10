import { App, Notice, TFolder, requestUrl } from "obsidian";
import { cardIdOf } from "./agent/card-id";
import { boardLink } from "./agent/context";
import { parseLeadMinutes } from "./notifications";
import {
  desiredReminders, markCancelled, markPosted, ntfyTarget, parseState, planSync,
  type NtfyState, type Reminder, type ReminderCard,
} from "./ntfy";
import type { CockpitBoardSettings } from "./types";
import { fmStr } from "./ui/dom-helpers.js";
import { getMarkdownFilesAt } from "./vault-helpers";

// What this device armed lives in localStorage, not data.json: data.json
// syncs, and each device must remember its own posts across restarts so a
// reminder it armed before closing is still cancelled when the card changes.
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
  private running = false;
  private again = false;
  private lastReassertMs = Date.now();
  private warned = false;
  private authWarned = false;

  constructor(private app: App, private settings: () => CockpitBoardSettings) {
    this.state = parseState(app.loadLocalStorage(STORAGE_KEY));
  }

  /** Bring the server in line with the cards. No-op while off or unconfigured. */
  async sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.syncOnce();
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  private async syncOnce(): Promise<void> {
    const s = this.settings();
    const target = ntfyTarget(s.ntfyServer, s.ntfyTopic);
    if (!s.ntfyEnabled || !target) return;
    // A missing tasks folder would read as "no cards" and cancel everything.
    if (!(this.app.vault.getAbstractFileByPath(s.folder) instanceof TFolder)) return;

    const now = Date.now();
    const reassert = now - this.lastReassertMs >= REASSERT_MS;
    const desired = desiredReminders(this.cards(s), parseLeadMinutes(s.notifyLeadMinutes), new Date(now), s.ntfyArmHours);
    const plan = planSync(this.state, desired, target, Math.floor(now / 1000), reassert);
    const done = await this.apply(plan.posts, plan.deletes, target);
    if (reassert && done) this.lastReassertMs = now;
  }

  /** Turning the feature off: cancel everything this device armed, then forget it. */
  async cancelAll(): Promise<void> {
    const s = this.settings();
    const target = ntfyTarget(s.ntfyServer, s.ntfyTopic);
    const plan = planSync(this.state, [], target, Math.floor(Date.now() / 1000), false);
    if (plan.deletes.length) await this.apply([], plan.deletes, target);
    this.state = { armed: {}, cancelled: {} };
    this.save();
  }

  /** Settings button: an immediate message, to check server, topic and token. */
  async testPush(): Promise<void> {
    const s = this.settings();
    const target = ntfyTarget(s.ntfyServer, s.ntfyTopic);
    if (!target) {
      new Notice("Set the ntfy server (https://...) and topic first.");
      return;
    }
    const status = await this.request("POST", target, { Title: "Cockpit board", Tags: "bell" },
      "Test push from Cockpit board. Reminders will look like this.");
    if (status >= 200 && status < 300) new Notice("Test push sent. It should show on your phone now.");
    else if (status === 401 || status === 403) new Notice(`The ntfy server refused the push (HTTP ${status}). Check the token and that it may write to this topic.`, 10000);
    else if (status === 0) new Notice("Could not reach the ntfy server.");
    else new Notice(`Test push failed (HTTP ${status}).`);
  }

  /** Runs posts, then deletes; stops at the first error the rest would repeat. True when all went out. */
  private async apply(posts: Reminder[], deletes: { seqId: string; target: string }[], target: string): Promise<boolean> {
    let ok = true;
    try {
      for (const r of posts) {
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
      for (const d of deletes) {
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
      return ok;
    } finally {
      this.save();
    }
  }

  private cards(s: CockpitBoardSettings): ReminderCard[] {
    const cards: ReminderCard[] = [];
    for (const file of getMarkdownFilesAt(this.app, s.folder)) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !fm.time || !fm.due) continue;
      cards.push({
        id: cardIdOf(this.app, file),
        title: fmStr(fm.title) || file.basename,
        project: fmStr(fm.project),
        status: fmStr(fm.status),
        due: fmStr(fm.due),
        time: fmStr(fm.time),
        click: boardLink(this.app, file),
      });
    }
    return cards;
  }

  /** HTTP status, or 0 when the server could not be reached. */
  private async request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<number> {
    const token = this.settings().ntfyToken.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
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
