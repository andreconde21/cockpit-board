import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { CockpitBoardSettings } from "../types";
import { fmStr, formatDateLocal } from "../ui/dom-helpers.js";

export interface AutoArchiveResult {
  moved: number;
  skipped: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Moves done cards from the tasks folder into the archive folder's
 * YYYY/MM/DD structure, based on their `completed` frontmatter date.
 * Cards completed fewer than `autoArchiveAfterDays` days ago are left alone.
 */
export async function archiveDoneCards(app: App, settings: CockpitBoardSettings): Promise<AutoArchiveResult> {
  const result: AutoArchiveResult = { moved: 0, skipped: 0 };
  if (!settings.folder || !settings.archiveFolder) return result;

  const folder = app.vault.getAbstractFileByPath(settings.folder);
  if (!(folder instanceof TFolder)) return result;

  const archivePrefix = normalizePath(settings.archiveFolder) + "/";
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(0, settings.autoArchiveAfterDays || 0));
  const cutoffStr = formatDateLocal(cutoff);

  const files: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFile && child.extension === "md") files.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(folder);

  for (const file of files) {
    // Guard against an archive folder nested inside the tasks folder
    if (file.path.startsWith(archivePrefix)) continue;

    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fmStr(fm.status) !== "done") continue;

    const completed = fmStr(fm.completed);
    if (!DATE_RE.test(completed)) {
      result.skipped++;
      continue;
    }
    if (completed > cutoffStr) continue;

    const [year, month, day] = completed.split("-");
    const destDir = normalizePath(`${settings.archiveFolder}/${year}/${month}/${day}`);
    if (!app.vault.getAbstractFileByPath(destDir)) {
      try {
        await app.vault.createFolder(destDir);
      } catch {
        // Folder may have been created concurrently (e.g. by sync)
      }
    }

    const destPath = `${destDir}/${file.name}`;
    if (app.vault.getAbstractFileByPath(destPath)) {
      result.skipped++;
      continue;
    }

    await app.fileManager.renameFile(file, destPath);
    result.moved++;
  }

  return result;
}
