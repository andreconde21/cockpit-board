// Minimal ICS parser for external calendar sync (Outlook publish links,
// exported .ics files). No dependencies — runs on desktop and mobile.
//
// Supported: VEVENT with UID, SUMMARY, DESCRIPTION, LOCATION, DTSTART,
// DTEND/DURATION, STATUS, RECURRENCE-ID, EXDATE and RRULE expansion for
// DAILY / WEEKLY (plus basic MONTHLY / YEARLY) inside a sync window.
// Cancelled instances (STATUS:CANCELLED or a "Canceled:" subject) never import
// and also suppress the base series occurrence on their day.
// TZID parameters have no bundled tz database, so non-UTC times are treated
// as floating local time — fine for an Outlook calendar in your own zone.

export interface IcsOccurrence {
  uid: string;
  title: string;
  description: string;
  location: string;
  /** Local YYYY-MM-DD for the cockpit `due` field. */
  dateStr: string;
  /** Local HH:MM for the cockpit `time` field ("" for all-day). */
  timeStr: string;
  /** Local YYYY-MM-DD when the event ends on a later day ("" otherwise). */
  endDateStr: string;
  isAllDay: boolean;
  /** Stable key per occurrence: uid + start date (+ recurrence id when present). */
  occurrenceKey: string;
  startMs: number;
}

interface RawEvent {
  uid: string;
  summary: string;
  /** True for STATUS:CANCELLED or a "Canceled:"/"Cancelled:" subject: never
   * imports, but still suppresses the base occurrence on its day. */
  excluded: boolean;
  description: string;
  location: string;
  dtstart?: ParsedDateTime;
  dtend?: ParsedDateTime;
  durationMs?: number;
  status?: string;
  rrule?: string;
  recurrenceId?: string;
  recurrenceIdMs?: number;
  exdates: Set<number>;
}

interface ParsedDateTime {
  dateStr: string;
  timeStr: string;
  isAllDay: boolean;
  ms: number;
}

const MAX_EVENTS = 2000;
const MAX_OCCURRENCES_PER_RULE = 250;

/**
 * Days that must not produce a card, per UID: moved instances (replaced by
 * their RECURRENCE-ID override) and cancelled instances (STATUS:CANCELLED or
 * a "Canceled:" subject tombstone). The original day is freed in both cases.
 * Exported so tooling can also clean up cards imported before this rule.
 */
export interface ParseOptions {
  /** IANA zone for naive (floating) times, e.g. "Europe/Zurich". Empty = device-local. */
  timeZone?: string;
}

export function suppressedDays(icsText: string, opts: ParseOptions = {}): Map<string, Set<string>> {
  const floatingTz = opts.timeZone?.trim() || undefined;
  const events = extractEvents(unfold(icsText), floatingTz);
  const suppressedByUid = new Map<string, Set<string>>();
  const suppress = (uid: string, ms: number | undefined) => {
    if (ms == null) return;
    const days = suppressedByUid.get(uid) || new Set<string>();
    days.add(dayKey(ms));
    suppressedByUid.set(uid, days);
  };
  for (const ev of events) {
    if (!ev.recurrenceId) continue;
    if (ev.excluded) suppress(ev.uid, ev.recurrenceIdMs ?? ev.dtstart?.ms);
    else suppress(ev.uid, ev.recurrenceIdMs);
  }
  // A standalone cancelled event also frees its own day for the same UID.
  for (const ev of events) {
    if (ev.recurrenceId || !ev.excluded || !ev.dtstart) continue;
    suppress(ev.uid, ev.dtstart.ms);
  }
  return suppressedByUid;
}

export function parseIcs(
  icsText: string,
  windowFromMs: number,
  windowToMs: number,
  opts: ParseOptions = {},
): IcsOccurrence[] {
  const floatingTz = opts.timeZone?.trim() || undefined;
  const events = extractEvents(unfold(icsText), floatingTz);
  const overridesByUid = new Map<string, RawEvent[]>();
  for (const ev of events) {
    if (ev.recurrenceId) {
      const list = overridesByUid.get(ev.uid) || [];
      list.push(ev);
      overridesByUid.set(ev.uid, list);
    }
  }

  const suppressedByUid = suppressedDays(icsText, opts);
  const isSuppressed = (uid: string, ms: number): boolean =>
    suppressedByUid.get(uid)?.has(dayKey(ms)) ?? false;

  const out: IcsOccurrence[] = [];
  for (const ev of events) {
    if (ev.recurrenceId) continue; // handled as override of its base series
    if (!ev.uid || !ev.dtstart) continue;
    if (ev.excluded) continue;

    const overrides = (overridesByUid.get(ev.uid) || []).filter((o) => !o.excluded);

    if (ev.rrule) {
      const occurrences = expandRRule(ev, windowFromMs, windowToMs);
      for (const occMs of occurrences) {
        if (ev.exdates.has(occMs)) continue;
        if (isSuppressed(ev.uid, occMs)) continue; // moved or cancelled that day
        const occ = toOccurrence(ev, occMs, null);
        if (occ && inWindow(occ, windowFromMs, windowToMs)) out.push(occ);
      }
      // Overrides outside the base expansion (moved instances) still import.
      for (const o of overrides) {
        if (!o.dtstart) continue;
        const occ = toOccurrence(o, o.dtstart.ms, o.recurrenceId || o.dtstart.dateStr);
        if (occ && inWindow(occ, windowFromMs, windowToMs)) out.push(occ);
      }
    } else {
      if (!isSuppressed(ev.uid, ev.dtstart.ms)) {
        const occ = toOccurrence(ev, ev.dtstart.ms, null);
        if (occ && inWindow(occ, windowFromMs, windowToMs)) out.push(occ);
      }
      for (const o of overrides) {
        if (!o.dtstart) continue;
        const occOverride = toOccurrence(o, o.dtstart.ms, o.recurrenceId || o.dtstart.dateStr);
        if (occOverride && inWindow(occOverride, windowFromMs, windowToMs)) out.push(occOverride);
      }
    }
    if (out.length > MAX_EVENTS) break;
  }
  out.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title));
  return out;
}

export function normalizeIcsUrl(raw: string): string {
  const url = raw.trim();
  if (url.toLowerCase().startsWith("webcal://")) return "https://" + url.slice("webcal://".length);
  return url;
}

export interface ClipRange {
  /** Local YYYY-MM-DD the export starts covering. */
  from: string;
  /** Local YYYY-MM-DD the export stops covering. */
  to: string;
}

/**
 * Range headers Outlook writes on range-limited exports (File > Save Calendar
 * with a date range). Absent on whole-calendar exports — then null, meaning
 * the file is complete truth for the sync window.
 */
export function calendarClipRange(icsText: string): ClipRange | null {
  const dateOf = (name: string): string | null => {
    const m = icsText.match(new RegExp(`^${name}:(\\d{8})T(\\d{6})Z?`, "m"));
    if (!m) return null;
    const utc = new Date(Date.UTC(
      Number(m[1].slice(0, 4)), Number(m[1].slice(4, 6)) - 1, Number(m[1].slice(6, 8)),
      Number(m[2].slice(0, 2)), Number(m[2].slice(2, 4)), Number(m[2].slice(4, 6)),
    ));
    return toDateStr(utc);
  };
  const from = dateOf("X-CLIPSTART") || dateOf("X-CALSTART");
  const to = dateOf("X-CLIPEND") || dateOf("X-CALEND");
  if (!from || !to) return null;
  return { from, to };
}

// ── Parsing ──

function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function extractEvents(lines: string[], floatingTz?: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = [];
    } else if (line === "END:VEVENT") {
      if (current) {
        const ev = parseEvent(current, floatingTz);
        if (ev) events.push(ev);
        if (events.length >= MAX_EVENTS) return events;
      }
      current = null;
    } else if (current !== null) {
      current.push(line);
    }
  }
  return events;
}

function parseEvent(lines: string[], floatingTz?: string): RawEvent | null {
  const props = new Map<string, { params: string; value: string }[]>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = left.indexOf(";");
    const name = (semi >= 0 ? left.slice(0, semi) : left).toUpperCase();
    const params = semi >= 0 ? left.slice(semi + 1) : "";
    const list = props.get(name) || [];
    list.push({ params, value });
    props.set(name, list);
  }

  const first = (name: string): { params: string; value: string } | undefined =>
    props.get(name)?.[0];
  const uid = first("UID")?.value.trim() || "";
  if (!uid) return null;

  const dtstartRaw = first("DTSTART");
  const dtstart = dtstartRaw ? parseDateProp(dtstartRaw.params, dtstartRaw.value, floatingTz) : undefined;
  const dtendRaw = first("DTEND");
  const dtend = dtendRaw ? parseDateProp(dtendRaw.params, dtendRaw.value, floatingTz) : undefined;
  const durationRaw = first("DURATION")?.value;
  const recIdRaw = first("RECURRENCE-ID");
  const recId = recIdRaw ? parseDateProp(recIdRaw.params, recIdRaw.value, floatingTz) : undefined;

  const exdates = new Set<number>();
  for (const ex of props.get("EXDATE") || []) {
    for (const part of ex.value.split(",")) {
      const parsed = parseDateProp(ex.params, part.trim(), floatingTz);
      if (parsed) exdates.add(stripTime(parsed.ms));
    }
  }

  const summary = unescapeText(first("SUMMARY")?.value || "");
  // Untitled calendar blocks (free/busy placeholders with no subject) carry
  // no information worth a card.
  if (!summary) return null;
  // Organizers often "cancel" by renaming the subject to "Canceled: ..." while
  // leaving STATUS untouched — treat that prefix (both spellings) as cancelled.
  // Excluded events are kept (not dropped) so their day can suppress the base
  // series occurrence: otherwise the tombstone is skipped but the ghost of the
  // meeting still imports.
  const status = first("STATUS")?.value.trim() || "";
  const excluded =
    status.toUpperCase() === "CANCELLED" || /^\s*cancell?ed\s*:/i.test(summary);

  return {
    uid,
    summary,
    excluded,
    description: unescapeText(first("DESCRIPTION")?.value || ""),
    location: unescapeText(first("LOCATION")?.value || ""),
    dtstart: dtstart ?? undefined,
    dtend: dtend ?? undefined,
    durationMs: durationRaw ? parseDuration(durationRaw) ?? undefined : undefined,
    status,
    rrule: first("RRULE")?.value.trim(),
    recurrenceId: recId ? recId.dateStr + (recId.timeStr ? "T" + recId.timeStr : "") : undefined,
    recurrenceIdMs: recId ? stripTime(recId.ms) : undefined,
    exdates,
  };
}

function parseDateProp(params: string, value: string, floatingTz?: string): ParsedDateTime | null {
  const v = value.trim();
  const upperParams = params.toUpperCase();
  // Date-only: 20260918 or with VALUE=DATE
  if (/^\d{8}$/.test(v) || upperParams.includes("VALUE=DATE")) {
    const y = Number(v.slice(0, 4));
    const m = Number(v.slice(4, 6));
    const d = Number(v.slice(6, 8));
    if (!y || !m || !d) return null;
    const local = new Date(y, m - 1, d, 0, 0, 0, 0);
    return { dateStr: toDateStr(local), timeStr: "", isAllDay: true, ms: local.getTime() };
  }
  // Date-time: 20260918T143000(Z?)
  const match = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const [, ys, ms, ds, hs, mins] = match;
  const isUtc = v.endsWith("Z");
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mins);
  let instantMs: number;
  if (isUtc) {
    instantMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  } else {
    // TZID parameter (often a Windows name from Outlook) wins; otherwise the
    // source timezone setting covers naive times; otherwise device-local time.
    const tzidMatch = params.match(/TZID="?([^";]+)"?/i);
    const tz = (tzidMatch && windowsToIana(tzidMatch[1])) || floatingTz || null;
    instantMs = tz
      ? wallTimeToUtcMs(y, mo, d, h, mi, tz)
      : new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  }
  // date/time strings always render the instant in device-local time.
  const local = new Date(instantMs);
  return {
    dateStr: toDateStr(local),
    timeStr: toTimeStr(local.getHours(), local.getMinutes()),
    isAllDay: false,
    ms: instantMs,
  };
}

// ── Timezones (Intl-based, no database needed) ──

/** True when `tz` is usable with Intl on this device. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Common Windows zone names (Outlook exports) mapped to IANA. */
export function windowsToIana(name: string): string | null {
  const key = name.trim().toLowerCase();
  return WINDOWS_TO_IANA[key] ?? null;
}

const WINDOWS_TO_IANA: Record<string, string> = {
  "w. europe standard time": "Europe/Berlin",
  "central european standard time": "Europe/Budapest",
  "central europe standard time": "Europe/Budapest",
  "romance standard time": "Europe/Paris",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Europe/London",
  "gmt": "UTC",
  "utc": "UTC",
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  "e. south america standard time": "America/Sao_Paulo",
  "india standard time": "Asia/Kolkata",
  "china standard time": "Asia/Shanghai",
  "tokyo standard time": "Asia/Tokyo",
  "aus eastern standard time": "Australia/Sydney",
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtfFor(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Offset of `tz` at the instant `utcMs`, in ms (positive east of UTC). */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts: Record<string, string> = {};
  for (const p of dtfFor(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - utcMs;
}

/** Instant (ms) for a wall-clock time in `tz`. DST-safe via one refinement. */
function wallTimeToUtcMs(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Two passes so a DST transition between guess and result still converges.
  return naive - tzOffsetMs(tz, naive - tzOffsetMs(tz, naive));
}

function parseDuration(value: string): number | undefined {
  // P1DT2H30M / PT1H / P7D — sign + weeks/days/hours/minutes/seconds
  const m = value.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const weeks = Number(m[2] || 0);
  const days = Number(m[3] || 0);
  const hours = Number(m[4] || 0);
  const minutes = Number(m[5] || 0);
  const seconds = Number(m[6] || 0);
  return sign * ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function unescapeText(s: string): string {
  return s
    .replace(/\\N|\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// ── Recurrence ──

function expandRRule(ev: RawEvent, fromMs: number, toMs: number): number[] {
  if (!ev.dtstart) return [];
  const rule = parseRRule(ev.rrule || "");
  const freq = (rule.FREQ || "").toUpperCase();
  if (!freq) return [ev.dtstart.ms];

  const interval = Math.max(1, Number(rule.INTERVAL || 1) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : undefined;
  const untilMs = rule.UNTIL ? parseRuleUntil(rule.UNTIL) : undefined;
  const byday = rule.BYDAY ? rule.BYDAY.split(",").map((s) => s.trim().toUpperCase()) : null;

  const start = new Date(ev.dtstart.ms);
  const out: number[] = [];
  const pushIf = (d: Date): boolean => {
    const ms = d.getTime();
    if (untilMs != null && ms > untilMs) return false;
    if (ms >= fromMs - 86400000 && ms <= toMs + 86400000) out.push(ms);
    return true;
  };

  if (freq === "DAILY") {
    const cursor = new Date(start);
    let n = 0;
    while (out.length + n < MAX_OCCURRENCES_PER_RULE) {
      if (count != null && n >= count) break;
      if (cursor.getTime() > toMs + 86400000 * 31) break;
      if (untilMs != null && cursor.getTime() > untilMs) break;
      if (cursor.getTime() >= fromMs - 86400000 * 2) {
        if (!pushIf(cursor)) break;
      }
      n++;
      cursor.setDate(cursor.getDate() + interval);
      if (n > MAX_OCCURRENCES_PER_RULE * interval) break;
    }
    return out;
  }

  if (freq === "WEEKLY") {
    const days = byday?.length ? byday.map(weekdayToNum).filter((n): n is number => n != null) : [start.getDay()];
    days.sort((a, b) => a - b);
    // Anchor week on the Sunday of the start week, step by interval weeks.
    const weekStart = new Date(start);
    weekStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    let produced = 0;
    let week = 0;
    while (produced < (count ?? MAX_OCCURRENCES_PER_RULE)) {
      for (const dow of days) {
        if (produced >= (count ?? MAX_OCCURRENCES_PER_RULE)) break;
        const d = new Date(weekStart);
        d.setDate(d.getDate() + week * interval * 7 + dow);
        d.setHours(start.getHours(), start.getMinutes(), 0, 0);
        if (d.getTime() < start.getTime()) continue;
        if (untilMs != null && d.getTime() > untilMs) return out;
        if (d.getTime() > toMs + 86400000 * 31) return out;
        produced++;
        if (d.getTime() >= fromMs - 86400000 * 2) out.push(d.getTime());
        if (out.length >= MAX_OCCURRENCES_PER_RULE) return out;
      }
      week++;
      if (week > 520) break; // ~10 years of weekly stepping
    }
    return out;
  }

  if (freq === "MONTHLY" || freq === "YEARLY") {
    const cursor = new Date(start);
    let n = 0;
    while (n < (count ?? MAX_OCCURRENCES_PER_RULE)) {
      if (untilMs != null && cursor.getTime() > untilMs) break;
      if (cursor.getTime() > toMs + 86400000 * 31) break;
      if (cursor.getTime() >= start.getTime() && cursor.getTime() >= fromMs - 86400000 * 2) {
        out.push(cursor.getTime());
      }
      n++;
      if (freq === "MONTHLY") cursor.setMonth(cursor.getMonth() + interval);
      else cursor.setFullYear(cursor.getFullYear() + interval);
      if (out.length >= MAX_OCCURRENCES_PER_RULE) break;
    }
    return out;
  }

  return [ev.dtstart.ms];
}

function parseRRule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

function parseRuleUntil(value: string): number | null {
  const v = value.trim();
  if (/^\d{8}T\d{6}Z$/.test(v)) {
    return Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)),
      Number(v.slice(9, 11)), Number(v.slice(11, 13)), Number(v.slice(13, 15)));
  }
  if (/^\d{8}$/.test(v)) {
    return new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)),
      23, 59, 59).getTime();
  }
  const asDate = new Date(v);
  return isNaN(asDate.getTime()) ? null : asDate.getTime();
}

function weekdayToNum(code: string): number | null {
  const map: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const short = code.slice(-2);
  return map[short] ?? null;
}

// ── Occurrence mapping ──

function toOccurrence(ev: RawEvent, startMs: number, recId: string | null): IcsOccurrence | null {
  const start = new Date(startMs);
  let endMs: number | null = null;
  if (ev.dtend) {
    const length = ev.dtend.ms - (ev.dtstart?.ms ?? ev.dtend.ms);
    endMs = startMs + Math.max(0, length);
  } else if (ev.durationMs != null) {
    endMs = startMs + Math.max(0, ev.durationMs);
  }
  const end = endMs != null ? new Date(endMs) : null;
  const isAllDay = ev.dtstart?.isAllDay ?? false;
  const dateStr = toDateStr(start);
  const timeStr = isAllDay ? "" : toTimeStr(start.getHours(), start.getMinutes());
  let endDateStr = "";
  if (end && toDateStr(end) !== dateStr) endDateStr = toDateStr(end);
  // Timed event ending after midnight same-day-early-hours stays single-day.
  // Multi-day all-day events keep due_end so the calendar spans them.

  const occurrenceKey = recId ? `${ev.uid}::${recId}` : `${ev.uid}::${dateStr}${timeStr ? "T" + timeStr : ""}`;
  return {
    uid: ev.uid,
    title: ev.summary,
    description: ev.description,
    location: ev.location,
    dateStr,
    timeStr,
    endDateStr,
    isAllDay,
    occurrenceKey,
    startMs,
  };
}

function inWindow(occ: IcsOccurrence, fromMs: number, toMs: number): boolean {
  return occ.startMs >= fromMs && occ.startMs <= toMs;
}

function stripTime(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(ms: number): string {
  return toDateStr(new Date(ms));
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTimeStr(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
