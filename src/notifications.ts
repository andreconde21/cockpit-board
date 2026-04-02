import { TFile, TFolder, Notice } from "obsidian";
import type { CockpitBoardSettings } from "./types";
import { fmStr, formatDateLocal } from "./ui/dom-helpers.js";

export function scheduleNotifications(
  settings: CockpitBoardSettings,
  notifiedToday: Set<string>,
  app: {
    vault: { getAbstractFileByPath(path: string): unknown };
    metadataCache: { getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null };
  },
): void {
  if (!settings.folder) return;
  const folder = app.vault.getAbstractFileByPath(settings.folder);
  if (!folder || !(folder instanceof TFolder)) return;

  const now = new Date();
  const todayStr = formatDateLocal(now);

  for (const child of folder.children || []) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const cache = app.metadataCache.getFileCache(child);
    const fm = cache?.frontmatter;
    if (!fm || fm.status === "done") continue;
    if (fm.due !== todayStr || !fm.time) continue;

    const key = `${child.path}-${todayStr}`;
    if (notifiedToday.has(key)) continue;

    const timeStr = fmStr(fm.time);
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const dueTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const minutesUntil = (dueTime.getTime() - now.getTime()) / 60000;

    if (minutesUntil > 0 && minutesUntil <= 15) {
      const title = fmStr(fm.title) || child.basename;
      const project = fmStr(fm.project);
      const prefix = project ? `[${project}] ` : "";
      new Notice(`\uD83D\uDD14 ${prefix}${title} starts in ${Math.round(minutesUntil)} minutes`, 10000);
      notifiedToday.add(key);
    }
  }
}
