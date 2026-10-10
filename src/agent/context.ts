import { App, FileSystemAdapter, Platform, TFile, getFrontMatterInfo } from "obsidian";
import { formatDisplayTitle } from "../CockpitCard";
import { fmStr } from "../ui/dom-helpers";
import { cardIdOf } from "./card-id";

// Ways to refer to a card, shared by the copy menu and the agent prompt. No
// Node APIs here: this runs on mobile too.

export type RefFormat =
  | "id" | "path" | "absPath" | "wikilink" | "obsidianUri" | "boardLink" | "title" | "context";

export const REF_FORMAT_NAMES: Record<RefFormat, string> = {
  id: "Card ID",
  path: "Vault path",
  absPath: "Absolute path",
  wikilink: "Wikilink",
  obsidianUri: "Obsidian link (opens the note)",
  boardLink: "Board link (opens the card on the board)",
  title: "Title",
  context: "Agent context (title, links, status and text)",
};

/** Absolute path on disk; null on mobile. */
export function absolutePath(app: App, file: TFile): string | null {
  if (!Platform.isDesktopApp) return null;
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter.getFullPath(file.path) : null;
}

export function obsidianUri(app: App, file: TFile): string {
  return `obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(file.path)}`;
}

export function boardLink(app: App, file: TFile): string {
  return `obsidian://cockpit-board?vault=${encodeURIComponent(app.vault.getName())}&card=${encodeURIComponent(cardIdOf(app, file))}`;
}

/** "[Project] Title" from the card's frontmatter. */
export function cardTitle(app: App, file: TFile): string {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return formatDisplayTitle(fmStr(fm.title) || file.basename, fmStr(fm.project));
}

export interface ContextOptions {
  /** Where the agent can read the card, when not at its path on this computer. */
  cardFile?: string;
  /** Include the card's text (default true). */
  includeBody?: boolean;
}

/** The context block: title, ID, path, links, status line and card text. */
export async function buildContext(app: App, file: TFile, opts: ContextOptions = {}): Promise<string> {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  const lines = [
    `Card: ${cardTitle(app, file)}`,
    `ID: ${cardIdOf(app, file)}`,
  ];
  if (opts.cardFile) lines.push(`Card file: ${opts.cardFile}`);
  else lines.push(`Path: ${absolutePath(app, file) ?? file.path}`);
  lines.push(`Board link: ${boardLink(app, file)}`);

  const status: string[] = [];
  const st = fmStr(fm.status);
  if (st) status.push(`Status: ${st}`);
  const due = [fmStr(fm.due), fmStr(fm.time)].filter(Boolean).join(" ");
  if (due) status.push(`Due: ${due}`);
  const labels: unknown = fm.labels;
  if (Array.isArray(labels) && labels.length) status.push(`Labels: ${labels.filter((l) => typeof l === "string").join(", ")}`);
  if (status.length) lines.push(status.join(" · "));

  if (opts.includeBody !== false) {
    const content = await app.vault.cachedRead(file);
    const body = content.slice(getFrontMatterInfo(content).contentStart).trim();
    if (body) lines.push("", body);
  }
  return lines.join("\n");
}

/** The text for one reference format. */
export async function formatReference(app: App, file: TFile, format: RefFormat): Promise<string> {
  switch (format) {
    case "id": return cardIdOf(app, file);
    case "path": return file.path;
    case "absPath": return absolutePath(app, file) ?? file.path;
    case "wikilink": return app.fileManager.generateMarkdownLink(file, "");
    case "obsidianUri": return obsidianUri(app, file);
    case "boardLink": return boardLink(app, file);
    case "title": return cardTitle(app, file);
    case "context": return buildContext(app, file);
  }
}

/** Formats available on this platform, in menu order. */
export function availableFormats(): RefFormat[] {
  const all: RefFormat[] = ["id", "path", "absPath", "wikilink", "obsidianUri", "boardLink", "title", "context"];
  return Platform.isDesktopApp ? all : all.filter((f) => f !== "absPath");
}
