import { TFile, TFolder, Notice } from "obsidian";
import type { CockpitBoardSettings } from "./types";

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
  const todayStr = now.toISOString().split("T")[0];

  for (const child of folder.children || []) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const cache = app.metadataCache.getFileCache(child);
    const fm = cache?.frontmatter;
    if (!fm || fm.status === "done") continue;
    if (fm.due !== todayStr || !fm.time) continue;

    const key = `${child.path}-${todayStr}`;
    if (notifiedToday.has(key)) continue;

    const timeStr = String(fm.time);
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const dueTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const minutesUntil = (dueTime.getTime() - now.getTime()) / 60000;

    if (minutesUntil > 0 && minutesUntil <= 15) {
      const title = fm.title || child.basename;
      const project = fm.project ? `[${fm.project}] ` : "";
      new Notice(`\uD83D\uDD14 ${project}${title} starts in ${Math.round(minutesUntil)} minutes`, 10000);
      notifiedToday.add(key);
    }
  }
}
