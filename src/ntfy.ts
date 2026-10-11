import { reminderText } from "./notifications";

// Phone reminders through an ntfy server. Each reminder is a scheduled ntfy
// message with a deterministic sequence ID, so posting it again replaces it
// and `DELETE {topic}/{id}` cancels it before it fires. Every open device
// computes the same IDs, so a laptop and a phone arming the same card give
// one notification, not two. Everything here is pure; the network and
// storage side lives in ntfy-sync.ts.

/** A card as the reminder code needs it, read from the metadata cache. */
export interface ReminderCard {
  path: string;
  id: string;
  title: string;
  project: string;
  status: string;
  due: string;
  time: string;
  /** Board deep link, opened when the notification is tapped. */
  click: string;
}

export interface Reminder {
  seqId: string;
  /** Fire time, unix seconds. */
  at: number;
  title: string;
  body: string;
  click: string;
}

/** What this device posted, keyed by sequence ID. */
export interface ArmedEntry {
  hash: string;
  at: number;
  /** `server/topic` it was posted to. */
  target: string;
}

/** A reminder to cancel; `done` is false while the DELETE still has to go out. */
export interface CancelledEntry {
  at: number;
  target: string;
  done: boolean;
}

/** A timed card as this device last saw it, keyed by path. */
export interface SeenCard {
  id: string;
  due: string;
  time: string;
  done: boolean;
}

export interface NtfyState {
  armed: Record<string, ArmedEntry>;
  cancelled: Record<string, CancelledEntry>;
  seen: Record<string, SeenCard>;
}

export interface SyncPlan {
  posts: Reminder[];
  deletes: { seqId: string; target: string }[];
}

// ntfy refuses `At` closer than ~10 s; a lead that close is the in-app
// Notice's job anyway.
export const MIN_DELAY_SEC = 15;
// ntfy's default message-delay-limit is 3 days.
export const MAX_ARM_HOURS = 72;
const SEQ_MAX = 64;

export function emptyState(): NtfyState {
  return { armed: {}, cancelled: {}, seen: {} };
}

/** 32-bit FNV-1a as 8 hex digits: stable across devices, no crypto needed. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * `cb-<card id>-<yyyy-mm-dd>-<lead>`, within ntfy's `[-_A-Za-z0-9]{1,64}`.
 * An ID that loses characters to the slug, or is cut to fit, gets a hash of
 * the original, so "Call: Ana" and "Call? Ana" stay two reminders.
 */
export function sequenceId(cardId: string, date: string, lead: number): string {
  const suffix = `-${date}-${lead}`;
  let slug = cardId.replace(/[^-_A-Za-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  const room = SEQ_MAX - "cb-".length - suffix.length;
  if (slug !== cardId || slug.length > room) {
    const hash = fnv1a(cardId);
    slug = slug.slice(0, room - hash.length - 1).replace(/-$/, "");
    slug = slug ? `${slug}-${hash}` : hash;
  }
  return `cb-${slug}${suffix}`;
}

/**
 * Two cards with the same ID (made on two devices while offline; the board
 * reports them) would share sequence IDs and replace each other's reminder.
 * Every card of a duplicated ID gets its path folded into the ID instead:
 * the vault path is the same on every device, so they still agree.
 */
export function withUniqueIds(cards: ReminderCard[]): ReminderCard[] {
  const count = new Map<string, number>();
  for (const c of cards) count.set(c.id, (count.get(c.id) ?? 0) + 1);
  return cards.map((c) => (count.get(c.id) ?? 0) > 1 ? { ...c, id: `${c.id}@${c.path}` } : c);
}

/** Due date + `HH:MM` in local time, or null when either does not parse. */
function dueDate(due: string, time: string): Date | null {
  const d = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return null;
  const h = Number(t[1]), m = Number(t[2]);
  if (h > 23 || m > 59) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, m);
}

/** Unix seconds of "too soon for ntfy" and the end of the arm-ahead window. */
function windowOf(now: Date, armHours: number): [number, number] {
  const nowSec = Math.floor(now.getTime() / 1000);
  const hours = Math.min(MAX_ARM_HOURS, Math.max(1, armHours || 0));
  return [nowSec + MIN_DELAY_SEC, nowSec + hours * 3600];
}

/** Sequence ID and fire time of each lead of a card, done or not. */
function leadTimes(card: { id: string; due: string; time: string }, leads: number[]): { seqId: string; at: number; lead: number; start: Date }[] {
  const start = dueDate(card.due, card.time);
  if (!start) return [];
  const startSec = Math.floor(start.getTime() / 1000);
  return leads.map((lead) => ({ seqId: sequenceId(card.id, card.due, lead), at: startSec - lead * 60, lead, start }));
}

/**
 * The reminders that should be scheduled now: one per open card with a
 * `time` and lead, whose fire time lies between "soon enough for ntfy" and
 * the arm-ahead window. Later ones are armed by a later run.
 */
export function desiredReminders(cards: ReminderCard[], leads: number[], now: Date, armHours: number): Reminder[] {
  const [from, until] = windowOf(now, armHours);
  const out: Reminder[] = [];
  for (const card of cards) {
    if (card.status === "done" || !card.time) continue;
    for (const { seqId, at, lead, start } of leadTimes(card, leads)) {
      if (at < from || at > until) continue;
      out.push({
        seqId,
        at,
        title: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
        body: reminderText(card.title, card.project, lead),
        click: card.click,
      });
    }
  }
  return out;
}

/**
 * The timed cards as this device sees them now, for the next
 * `staleReminders`. `unread` are files that exist but are not in the
 * metadata cache yet (indexing, or Dropbox just synced them): unknown is not
 * deleted, so they keep their last entry.
 */
export function snapshotCards(cards: ReminderCard[], prev: Record<string, SeenCard> = {}, unread: Set<string> = new Set()): Record<string, SeenCard> {
  const seen: Record<string, SeenCard> = {};
  for (const path of Array.from(unread)) if (prev[path]) seen[path] = prev[path];
  for (const c of cards) {
    if (c.due && c.time) seen[c.path] = { id: c.id, due: c.due, time: c.time, done: c.status === "done" };
  }
  return seen;
}

/**
 * Reminders another device may have scheduled that no longer match a card,
 * still to fire within the window. Only the posting device knows what it
 * posted, and it may be asleep, so every device also cancels from what it
 * sees: a done card's own reminders, and the old reminders of every card it
 * saw before that was re-dated, retimed, renamed to another ID, deleted or
 * moved out of the tasks folder. Exact IDs and fire times only, so nothing
 * that already fired is touched.
 */
export function staleReminders(
  prev: Record<string, SeenCard>,
  cards: ReminderCard[],
  desired: Reminder[],
  leads: number[],
  now: Date,
  armHours: number,
  unread: Set<string> = new Set(),
): { seqId: string; at: number }[] {
  const [from, until] = windowOf(now, armHours);
  const wanted = new Set(desired.map((r) => r.seqId));
  const byPath = new Map(cards.map((c) => [c.path, c]));
  const out = new Map<string, number>();
  const add = (card: { id: string; due: string; time: string }) => {
    for (const { seqId, at } of leadTimes(card, leads)) {
      if (at >= from && at <= until && !wanted.has(seqId)) out.set(seqId, at);
    }
  };
  for (const c of cards) if (c.status === "done") add(c);
  for (const [path, old] of Object.entries(prev)) {
    if (old.done || unread.has(path)) continue;
    const cur = byPath.get(path);
    if (cur && cur.status !== "done" && cur.id === old.id && cur.due === old.due && cur.time === old.time) continue;
    add(old);
  }
  return Array.from(out).map(([seqId, at]) => ({ seqId, at }));
}

/** Reminders of unread files, as last seen: neither posted nor cancelled until the file is read. */
export function heldReminders(prev: Record<string, SeenCard>, unread: Set<string>, leads: number[]): Set<string> {
  const held = new Set<string>();
  for (const path of Array.from(unread)) {
    const old = prev[path];
    if (old && !old.done) for (const { seqId } of leadTimes(old, leads)) held.add(seqId);
  }
  return held;
}

/** Queue cancellations, once each; a known one is left alone. */
export function addCancels(state: NtfyState, cancels: { seqId: string; at: number }[], target: string): void {
  for (const { seqId, at } of cancels) {
    if (state.cancelled[seqId] || state.armed[seqId]) continue;
    state.cancelled[seqId] = { at, target, done: false };
  }
}

export function reminderHash(r: Reminder, target: string): string {
  return fnv1a([target, r.at, r.title, r.body, r.click].join("\n"));
}

/** Forget reminders whose time has passed: they fired, and a DELETE now would only retract the delivered notification. */
export function pruneState(state: NtfyState, nowSec: number): void {
  for (const [id, e] of Object.entries(state.armed)) if (e.at <= nowSec) delete state.armed[id];
  for (const [id, e] of Object.entries(state.cancelled)) if (e.at <= nowSec) delete state.cancelled[id];
}

/**
 * Deletes and posts that take the server from what this device armed to
 * what it wants now; deletes go first. `force` re-sends everything (see
 * ntfy-sync.ts on why). With nothing desired this undoes all this device armed.
 */
export function planSync(
  state: NtfyState,
  desired: Reminder[],
  target: string,
  nowSec: number,
  force: boolean,
  held: Set<string> = new Set(),
): SyncPlan {
  pruneState(state, nowSec);
  const plan: SyncPlan = { posts: [], deletes: [] };
  const wanted = new Set<string>(held);
  for (const r of desired) {
    wanted.add(r.seqId);
    const armed = state.armed[r.seqId];
    if (force || !armed || armed.hash !== reminderHash(r, target)) plan.posts.push(r);
    // Server or topic changed: the copy on the old one would still fire.
    if (armed && armed.target !== target) plan.deletes.push({ seqId: r.seqId, target: armed.target });
  }
  for (const [seqId, armed] of Object.entries(state.armed)) {
    if (!wanted.has(seqId)) plan.deletes.push({ seqId, target: armed.target });
  }
  for (const [seqId, c] of Object.entries(state.cancelled)) {
    if (wanted.has(seqId) || state.armed[seqId]) continue;
    if (force || !c.done) plan.deletes.push({ seqId, target: c.target });
  }
  return plan;
}

/** Record a successful post. */
export function markPosted(state: NtfyState, r: Reminder, target: string): void {
  state.armed[r.seqId] = { hash: reminderHash(r, target), at: r.at, target };
  delete state.cancelled[r.seqId];
}

/**
 * Record a DELETE, sent or not. A cancellation is remembered until its fire
 * time: unsent ones are retried, sent ones repeated on the periodic re-send
 * in case another device brought the reminder back.
 */
export function markCancelled(state: NtfyState, seqId: string, target: string, sent: boolean): void {
  const armed = state.armed[seqId];
  if (armed && armed.target === target) delete state.armed[seqId];
  const prev = state.cancelled[seqId];
  state.cancelled[seqId] = { at: armed?.at ?? prev?.at ?? 0, target, done: sent };
}

/** True when this device still has DELETEs to send or reminders it could cancel. */
export function hasPending(state: NtfyState): boolean {
  return Object.keys(state.armed).length > 0 || Object.values(state.cancelled).some((c) => !c.done);
}

/** State read back from localStorage, tolerating anything malformed. */
export function parseState(raw: unknown): NtfyState {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Partial<NtfyState>;
  for (const [id, e] of Object.entries(r.armed ?? {})) {
    if (e && typeof e.hash === "string" && typeof e.at === "number" && typeof e.target === "string") state.armed[id] = e;
  }
  for (const [id, e] of Object.entries(r.cancelled ?? {})) {
    if (e && typeof e.at === "number" && typeof e.target === "string") state.cancelled[id] = { at: e.at, target: e.target, done: e.done === true };
  }
  for (const [path, e] of Object.entries(r.seen ?? {})) {
    if (e && typeof e.id === "string" && typeof e.due === "string" && typeof e.time === "string") state.seen[path] = { ...e, done: e.done === true };
  }
  return state;
}

/** `https://host/` + topic, normalised, or "" when either is missing. */
export function ntfyTarget(server: string, topic: string): string {
  const base = server.trim().replace(/\/+$/, "");
  const t = topic.trim().replace(/^\/+|\/+$/g, "");
  if (!/^https?:\/\/\S+$/.test(base) || !/^[-_A-Za-z0-9]{1,64}$/.test(t)) return "";
  return `${base}/${t}`;
}

/** A token only travels over https, or plain http to this machine. */
export function mayCarryToken(url: string): boolean {
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
}
