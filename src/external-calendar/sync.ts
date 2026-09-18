import { App, Notice, TFile, requestUrl } from "obsidian";
import type { CockpitBoardSettings, ExternalCalendarSource } from "../types";
import { formatDateLocal, todayStr } from "../ui/dom-helpers.js";
import { getMarkdownFilesAt } from "../vault-helpers";
import {
  calendarClipRange,
  isValidTimeZone,
  normalizeIcsUrl,
  parseIcs,
  type ClipRange,
  type IcsOccurrence,
} from "./ics-parser";

export interface ExternalSyncResult {
  sourceId: string;
  sourceName: string;
  created: number;
  skipped: number;
  updated: number;
  pruned: string[];
  error?: string;
}

/** Frontmatter dates arrive as strings or Date objects depending on quoting. */
function fmDateStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date && !isNaN(value.getTime())) return formatDateLocal(value);
  return "";
}

/** Frontmatter times arrive as strings; unquoted HH:MM parses as minutes. */
function fmTimeStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }
  return "";
}

/** The stable part of a sync key: everything but the source prefix. */
function stripSourcePrefix(key: string, sourceId: string): string {
  return key.startsWith(sourceId + "::") ? key.slice(sourceId.length + 2) : key;
}

/** Meeting identity: same event UID on the same day, regardless of time. */
function meetingIdFor(sourceId: string, key: string): string | null {
  const rest = stripSourcePrefix(key, sourceId).split("::");
  if (rest.length < 2) return null;
  const date = rest[rest.length - 1].slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return rest.slice(0, rest.length - 1).join("::") + "@" + date;
}

/**
 * Seen keys whose event no longer occurs in the current file. Only keys whose
 * date falls inside the sync window qualify — and, for range-limited exports
 * (which carry X-CLIPSTART/X-CLIPEND headers), inside the export's range too.
 * Anything outside may simply be out of range, not cancelled.
 * Pure (no vault access) for testability; callers verify files separately.
 */
export function findStaleSeenKeys(
  seen: ExternalSeenMap,
  sourceId: string,
  occurrences: IcsOccurrence[],
  windowFromMs: number,
  windowToMs: number,
  clip: ClipRange | null,
): string[] {
  const live = new Set(occurrences.map((o) => externalSyncKey(sourceId, o)));
  const windowFromDay = formatDateLocal(new Date(windowFromMs));
  const windowToDay = formatDateLocal(new Date(windowToMs));
  const stale: string[] = [];
  for (const key of Object.keys(seen)) {
    if (!key.startsWith(sourceId + "::")) continue;
    if (live.has(key)) continue;
    const tail = key.split("::").pop() || "";
    const date = tail.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date < windowFromDay || date > windowToDay) continue;
    if (clip && (date < clip.from || date > clip.to)) continue;
    stale.push(key);
  }
  return stale;
}

/** Seen map persisted in plugin data: syncKey -> card path. */
export type ExternalSeenMap = Record<string, string>;

export function externalSyncKey(sourceId: string, occ: IcsOccurrence): string {
  return `${sourceId}::${occ.occurrenceKey}`;
}

function windowFor(source: ExternalCalendarSource): { fromMs: number; toMs: number } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const from = new Date(now);
  from.setDate(from.getDate() - Math.max(0, source.daysBack ?? 7));
  const to = new Date(now);
  to.setDate(to.getDate() + Math.max(1, source.daysAhead ?? 60));
  to.setHours(23, 59, 59, 999);
  return { fromMs: from.getTime(), toMs: to.getTime() };
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(path);
}

type NodeRequire = (mod: string) => unknown;

function nodeRequire(): NodeRequire | null {
  // Bare require exists in desktop Electron, not on mobile — typeof guard
  // keeps this safe everywhere.
  try {
    const req = (typeof require === "function" ? require : null) as NodeRequire | null;
    return req;
  } catch {
    return null;
  }
}

/** Desktop-only fallback so a file outside the vault (e.g. ~/Downloads) can sync. */
async function readAbsoluteFile(path: string): Promise<string> {
  const req = nodeRequire();
  if (!req) {
    throw new Error(
      `Cannot read ${path} here — files outside the vault only sync on desktop. ` +
        `Copy the .ics into your vault and use its vault path instead.`,
    );
  }
  const os = req("os") as { homedir: () => string };
  const expanded = path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
  const fs = req("fs") as { promises: { readFile: (p: string, enc: string) => Promise<string> } };
  return await fs.promises.readFile(expanded, "utf8");
}

async function loadIcsText(app: App, source: ExternalCalendarSource): Promise<string> {
  if (source.url.trim()) {
    const url = normalizeIcsUrl(source.url);
    const res = await requestUrl({ url, method: "GET", throw: false });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status} fetching calendar`);
    }
    return res.text;
  }
  const path = source.filePath.trim();
  if (path) {
    if (isAbsolutePath(path)) return await readAbsoluteFile(path);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(
        `ICS file not found in vault: ${path}. Use a vault-relative path like Calendars/client.ics, ` +
          `or an absolute desktop path like ~/Downloads/client.ics.`,
      );
    }
    return await app.vault.read(file);
  }
  throw new Error("No ICS URL or file configured");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 50) || "event";
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uniquePath(app: App, folder: string, base: string): string {
  let path = `${folder}/${base}.md`;
  let i = 1;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${folder}/${base}-${i}.md`;
    i++;
  }
  return path;
}

/**
 * Reconcile a card for the same meeting (same UID + day) whose key changed.
 * - "updated": card still held the imported date/time → moved in place.
 * - "kept": user already changed the date/time → theirs wins; only the
 *   tracking id is refreshed so this decision sticks instead of duplicating.
 * - null: card gone, not ours, or write failed → caller falls through.
 */
async function updateMovedCard(
  app: App,
  source: ExternalCalendarSource,
  seen: ExternalSeenMap,
  oldKey: string,
  newKey: string,
  occ: IcsOccurrence,
): Promise<"updated" | "kept" | null> {
  const oldPath = seen[oldKey];
  const file = oldPath ? app.vault.getAbstractFileByPath(oldPath) : null;
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter as Record<string, unknown> | undefined;
  if (!fm || fm.source !== "external-calendar") return null;
  const oldTail = stripSourcePrefix(oldKey, source.id).split("::").pop() || "";
  const oldDate = oldTail.slice(0, 10);
  const oldTime = oldTail.includes("T") ? oldTail.slice(11) : "";
  const untouched = fmDateStr(fm.due) === oldDate && fmTimeStr(fm.time) === oldTime;
  const newEnd = occ.endDateStr || "";
  const curEnd = fmDateStr(fm.due_end);
  try {
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (untouched) {
        frontmatter.due = occ.dateStr;
        frontmatter.time = occ.timeStr;
        if (curEnd === "" || curEnd === newEnd) frontmatter.due_end = newEnd;
      }
      frontmatter.external_uid = newKey;
    });
  } catch {
    return null;
  }
  delete seen[oldKey];
  seen[newKey] = file.path;
  return untouched ? "updated" : "kept";
}

/**
 * One-way EDITABLE import: new Outlook/ICS occurrences become cards with the
 * source label. Cards already imported (tracked in `seen`) are never
 * overwritten, so edits in Obsidian are safe. A known meeting whose key
 * changed (moved in Outlook, timezone correction) updates in place instead of
 * duplicating. Events that vanish from the calendar are handled per the
 * source's onDisappear setting (keep/done/delete).
 */
export async function syncExternalSource(
  app: App,
  settings: CockpitBoardSettings,
  source: ExternalCalendarSource,
  seen: ExternalSeenMap,
): Promise<ExternalSyncResult> {
  const result: ExternalSyncResult = {
    sourceId: source.id,
    sourceName: source.name || source.label || "External calendar",
    created: 0,
    skipped: 0,
    updated: 0,
    pruned: [],
  };
  const folder = settings.folder;
  if (!folder) {
    result.error = "Set a tasks folder first";
    return result;
  }
  const label = (source.label || source.name || "").trim();
  if (!label) {
    result.error = "Missing label";
    return result;
  }
  const project = (source.project || "").trim();
  const timeZone = (source.timeZone || "").trim();
  if (timeZone && !isValidTimeZone(timeZone)) {
    result.error = `Unknown timezone "${timeZone}" — use an IANA name like Europe/Zurich`;
    return result;
  }

  const icsText = await loadIcsText(app, source);
  const { fromMs, toMs } = windowFor(source);
  const occurrences = parseIcs(icsText, fromMs, toMs, timeZone ? { timeZone } : undefined);

  // Rebuild guard: if plugin data was lost, don't duplicate cards that carry
  // the same sync key in frontmatter.
  const knownKeys = new Set(Object.keys(seen));
  if (knownKeys.size === 0) {
    for (const file of getMarkdownFilesAt(app, folder)) {
      const cache = app.metadataCache.getFileCache(file);
      const key = cache?.frontmatter?.external_uid;
      if (typeof key === "string" && key.startsWith(source.id + "::")) {
        knownKeys.add(key);
        seen[key] = file.path;
      }
    }
  }

  // Same meeting (UID + day) under a changed key: the instance moved in time
  // (Outlook edit, timezone correction). Update that card in place instead of
  // importing a duplicate — but only while it still holds the imported values.
  const keyByMeeting = new Map<string, string>();
  for (const key of knownKeys) {
    const id = meetingIdFor(source.id, key);
    if (id && !keyByMeeting.has(id)) keyByMeeting.set(id, key);
  }

  const today = todayStr();
  for (const occ of occurrences) {
    const key = externalSyncKey(source.id, occ);
    if (knownKeys.has(key)) {
      result.skipped++;
      continue;
    }
    const existing = seen[key];
    if (existing && app.vault.getAbstractFileByPath(existing)) {
      result.skipped++;
      continue;
    }

    const meetingId = `${occ.uid}@${occ.dateStr}`;
    const oldKey = keyByMeeting.get(meetingId);
    if (oldKey && oldKey !== key) {
      const outcome = await updateMovedCard(app, source, seen, oldKey, key, occ);
      if (outcome) {
        knownKeys.delete(oldKey);
        knownKeys.add(key);
        keyByMeeting.set(meetingId, key);
        if (outcome === "updated") result.updated++;
        else result.skipped++;
        continue;
      }
    }

    const base = `${slugify(occ.title)}-${occ.dateStr}`;
    const path = uniquePath(app, folder, base);
    const bodyLines: string[] = [];
    if (occ.location) bodyLines.push(`Location: ${occ.location}`);
    if (occ.description) bodyLines.push("", occ.description.slice(0, 2000));
    bodyLines.push("", `> Imported from ${result.sourceName} on ${today}. Edits here are kept — sync only adds new events.`);

    const content =
      `---\ntitle: ${yamlStr(occ.title)}\nstatus: scheduled\n` +
      `due: ${occ.dateStr}\ntime: ${yamlStr(occ.timeStr)}\n` +
      `due_end: ${occ.endDateStr || ""}\ncompleted:\nproject: ${project ? yamlStr(project) : '""'}\n` +
      `labels: [${yamlStr(label)}]\ncreated: ${today}\nsource: external-calendar\n` +
      `external_uid: ${yamlStr(key)}\nexternal_source: ${yamlStr(result.sourceName)}\n---\n\n` +
      `# ${occ.title}\n\n${bodyLines.join("\n")}\n`;

    await app.vault.create(path, content);
    seen[key] = path;
    knownKeys.add(key);
    result.created++;
  }

  // Prune cards whose event vanished from the calendar (deleted or moved in
  // Outlook leave no trace in the file). Never touches cards the user already
  // marked done, and never drops seen keys for files the user deleted
  // themselves — only for cards this sync handles.
  const action = source.onDisappear || "keep";
  if (action !== "keep") {
    const clip: ClipRange | null = calendarClipRange(icsText);
    const stale = findStaleSeenKeys(seen, source.id, occurrences, fromMs, toMs, clip);
    for (const key of stale) {
      const file = app.vault.getAbstractFileByPath(seen[key]);
      if (!(file instanceof TFile)) continue;
      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.source !== "external-calendar") continue;
      if (typeof fm.status === "string" && fm.status.toLowerCase() === "done") continue;
      const title = typeof fm.title === "string" && fm.title ? fm.title : file.basename;
      try {
        if (action === "delete") {
          await app.vault.delete(file);
          delete seen[key];
        } else {
          await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            frontmatter.status = "done";
            frontmatter.completed = todayStr();
          });
        }
        result.pruned.push(title);
      } catch {
        // A locked or concurrently edited file stays for the next sync.
      }
    }
  }
  return result;
}

export async function syncAllExternalCalendars(
  app: App,
  settings: CockpitBoardSettings,
  seen: ExternalSeenMap,
  opts: { notify?: boolean } = {},
): Promise<ExternalSyncResult[]> {
  const results: ExternalSyncResult[] = [];
  for (const source of settings.externalCalendars || []) {
    if (!source.enabled) continue;
    if (!source.url.trim() && !source.filePath.trim()) continue;
    try {
      const r = await syncExternalSource(app, settings, source, seen);
      source.lastSync = new Date().toISOString();
      results.push(r);
    } catch (e: unknown) {
      results.push({
        sourceId: source.id,
        sourceName: source.name || "External calendar",
        created: 0,
        skipped: 0,
        updated: 0,
        pruned: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const created = results.reduce((n, r) => n + r.created, 0);
  const updated = results.reduce((n, r) => n + r.updated, 0);
  const pruned = results.reduce((n, r) => n + r.pruned.length, 0);
  const errors = results.filter((r) => r.error);
  if (opts.notify) {
    const bits: string[] = [];
    if (created > 0) bits.push(`imported ${created} event(s)`);
    if (updated > 0) bits.push(`adjusted ${updated} moved event(s)`);
    if (pruned > 0) bits.push(`removed ${pruned} cancelled event(s)`);
    if (bits.length > 0) {
      new Notice(`Calendar sync: ${bits.join(", ")}`, 4000);
    } else if (errors.length > 0) {
      new Notice(`Calendar sync failed: ${errors[0].error}`, 5000);
    } else if (results.length > 0) {
      new Notice("Calendar sync: already up to date", 2500);
    }
  }
  return results;
}
