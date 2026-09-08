import { App, TFile, TFolder } from "obsidian";

/** Every markdown file under `folder`, recursively. */
export function getMarkdownFiles(folder: TFolder): TFile[] {
  const files: TFile[] = [];
  const walk = (current: TFolder) => {
    for (const child of current.children) {
      if (child instanceof TFile && child.extension === "md") files.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(folder);
  return files;
}

/** Markdown files under the folder at `path`, or an empty list when it is unset or missing. */
export function getMarkdownFilesAt(app: App, path: string): TFile[] {
  if (!path) return [];
  const folder = app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? getMarkdownFiles(folder) : [];
}

/** True when `path` is `folder` itself or lives inside it. */
export function isInFolder(path: string, folder: string): boolean {
  const base = folder.replace(/\/+$/, "");
  if (!base) return false;
  return path === base || path.startsWith(base + "/");
}
