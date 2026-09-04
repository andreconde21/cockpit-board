import { App, TFile, TFolder, Notice } from "obsidian";
import type { CockpitBoardSettings } from "./types";
import { fmStr, formatDateLocal } from "./ui/dom-helpers.js";

const DEFAULT_LEADS = [15, 1];

// Lead times are minutes-before-start, largest first, so a card that is
// already inside the smallest window does not first fire the 15-minute
// warning it slept through.
export function parseLeadMinutes(raw: string): number[] {
  const leads = (raw || "")
    .split(",")
    .map(v => parseInt(v.trim(), 10))
    .filter(n => !isNaN(n) && n > 0 && n <= 1440);
  const unique = [...new Set(leads)];
  return unique.length ? unique.sort((a, b) => b - a) : DEFAULT_LEADS;
}

export function scheduleNotifications(
  settings: CockpitBoardSettings,
  notifiedToday: Set<string>,
  app: App,
): void {
  if (!settings.folder) return;
  const folder = app.vault.getAbstractFileByPath(settings.folder);
  if (!folder || !(folder instanceof TFolder)) return;

  const now = new Date();
  const todayStr = formatDateLocal(now);
  const leads = parseLeadMinutes(settings.notifyLeadMinutes);

  for (const child of getMarkdownFiles(folder)) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const cache = app.metadataCache.getFileCache(child);
    const fm = cache?.frontmatter;
    if (!fm || fm.status === "done") continue;
    if (fm.due !== todayStr || !fm.time) continue;

    const timeStr = fmStr(fm.time);
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const dueTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const minutesUntil = (dueTime.getTime() - now.getTime()) / 60000;
    if (minutesUntil <= 0) continue;

    // The first lead the card has entered wins; the shorter ones still fire
    // later on their own tick, so a 15/1 setup warns twice.
    const lead = leads.find(l => minutesUntil <= l);
    if (lead === undefined) continue;

    const key = `${child.path}-${todayStr}-${lead}`;
    if (notifiedToday.has(key)) continue;
    // A card caught inside a shorter window skips the longer ones it slept
    // through, so reopening Obsidian at 10:29 does not fire a "15 minutes"
    // notice for a 10:30 meeting.
    for (const l of leads) {
      if (l >= lead) notifiedToday.add(`${child.path}-${todayStr}-${l}`);
    }

    const title = fmStr(fm.title) || child.basename;
    const project = fmStr(fm.project);
    const prefix = project ? `[${project}] ` : "";
    const mins = Math.max(1, Math.round(minutesUntil));
    const body = `${prefix}${title} starts in ${mins} minute${mins === 1 ? "" : "s"}`;

    new Notice(`🔔 ${body}`, 10000);
    if (settings.notifySystem) systemNotify(body, timeStr);
  }
}

// An in-app Notice is only seen when Obsidian is on screen; a desktop
// notification reaches the notification daemon, which is the point of a
// one-minute warning.
function systemNotify(body: string, timeStr: string): void {
  try {
    const Ctor = (window as unknown as { Notification?: typeof Notification }).Notification;
    if (!Ctor) return;
    const fire = () => { new Ctor(`🔔 ${timeStr}`, { body }); };
    if (Ctor.permission === "granted") fire();
    else if (Ctor.permission !== "denied") void Ctor.requestPermission().then(p => { if (p === "granted") fire(); });
  } catch {
    // Desktop notifications are best-effort; the Notice already fired.
  }
}

function getMarkdownFiles(folder: TFolder): TFile[] {
  const files: TFile[] = [];
  const walk = (current: TFolder) => {
    for (const child of current.children) {
      if (child instanceof TFile && child.extension === "md") {
        files.push(child);
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  };
  walk(folder);
  return files;
}
