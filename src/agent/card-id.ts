import { App, TFile } from "obsidian";
import type { CardFrontmatter, CockpitBoardSettings } from "../types";
import { getMarkdownFilesAt } from "../vault-helpers";

// Card IDs: a card's ID is its `id:` frontmatter when set, otherwise its file
// basename. With "Assign card IDs" on, new cards get `<PREFIX>-<n>`, where n is
// one above the highest number in the tasks and archive folders.

/** Highest number handed out per prefix in this session. The metadata cache
 * lags a file that was just created, so a burst of new cards (recurring,
 * calendar import) would otherwise all read the same maximum. */
const highWater = new Map<string, number>();

/** Uppercase letters and digits only; "CB" when nothing usable is left. */
export function normalizePrefix(prefix: string): string {
  return prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") || "CB";
}

/** The `id:` frontmatter value of a file, "" when it has none. */
export function frontmatterId(app: App, file: TFile): string {
  const id: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" ? id.trim() : "";
}

/** The card's ID: `id:` frontmatter, or the file basename. */
export function cardIdOf(app: App, file: TFile): string {
  return frontmatterId(app, file) || file.basename;
}

/** Every card file the IDs are unique across: tasks folder and archive. */
export function cardFiles(app: App, settings: CockpitBoardSettings): TFile[] {
  const files = getMarkdownFilesAt(app, settings.folder);
  if (settings.archiveFolder && settings.archiveFolder !== settings.folder) {
    files.push(...getMarkdownFilesAt(app, settings.archiveFolder));
  }
  return files;
}

/** Number part of `id` when it is `<prefix>-<n>`, otherwise null. */
export function idNumber(id: string, prefix: string): number | null {
  const m = id.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!m || m[1].toUpperCase() !== prefix) return null;
  return Number(m[2]);
}

/** Reserve the next `<PREFIX>-<n>` (synchronous, safe inside processFrontMatter). */
export function nextCardId(app: App, settings: CockpitBoardSettings): string {
  const prefix = normalizePrefix(settings.cardIdPrefix);
  let max = highWater.get(prefix) ?? 0;
  for (const file of cardFiles(app, settings)) {
    const n = idNumber(frontmatterId(app, file), prefix);
    if (n !== null && n > max) max = n;
  }
  const next = max + 1;
  highWater.set(prefix, next);
  return `${prefix}-${next}`;
}

/** Give a newly created card an ID when assigning is on and it has none. */
export async function ensureCardId(app: App, settings: CockpitBoardSettings, file: TFile): Promise<void> {
  if (!settings.assignCardIds) return;
  await app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => {
    if (fm.id === undefined || fm.id === null || fm.id === "") fm.id = nextCardId(app, settings);
  });
}

/**
 * For a card copied from another (duplicate, split): the copy must not keep
 * the original's ID. Call inside the copy's processFrontMatter.
 */
export function resetCopiedId(app: App, settings: CockpitBoardSettings, fm: CardFrontmatter): void {
  if (settings.assignCardIds) fm.id = nextCardId(app, settings);
  else delete fm.id;
}

/** IDs used by more than one card, with their files (oldest first). */
export function findDuplicateIds(app: App, settings: CockpitBoardSettings): Map<string, TFile[]> {
  const byId = new Map<string, TFile[]>();
  for (const file of cardFiles(app, settings)) {
    const id = frontmatterId(app, file);
    if (!id) continue;
    const list = byId.get(id) ?? [];
    list.push(file);
    byId.set(id, list);
  }
  const dupes = new Map<string, TFile[]>();
  for (const [id, files] of byId) {
    if (files.length > 1) dupes.set(id, files.sort(byAge(app)));
  }
  return dupes;
}

/** Oldest first: `created:` frontmatter, then file creation time. */
function byAge(app: App): (a: TFile, b: TFile) => number {
  const created = (f: TFile): string => {
    const v: unknown = app.metadataCache.getFileCache(f)?.frontmatter?.created;
    return typeof v === "string" ? v : "";
  };
  return (a, b) => created(a).localeCompare(created(b)) || a.stat.ctime - b.stat.ctime;
}

/**
 * Give every card in the tasks folder without an ID one (oldest first), and
 * renumber the newer cards of any duplicate. Returns how many cards changed.
 */
export async function assignMissingIds(app: App, settings: CockpitBoardSettings): Promise<number> {
  let changed = 0;
  for (const files of findDuplicateIds(app, settings).values()) {
    for (const file of files.slice(1)) {
      await app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => { fm.id = nextCardId(app, settings); });
      changed++;
    }
  }
  const missing = getMarkdownFilesAt(app, settings.folder)
    .filter((f) => !frontmatterId(app, f))
    .sort(byAge(app));
  for (const file of missing) {
    await app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => { fm.id = nextCardId(app, settings); });
    changed++;
  }
  return changed;
}
