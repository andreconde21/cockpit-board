import { reminderText } from "./notifications";

// Phone reminders through an ntfy server. Each reminder is a scheduled ntfy
// message with a deterministic sequence ID, so posting it again replaces it
// and `DELETE {topic}/{id}` cancels it before it fires. Every open device
// computes the same IDs, so a laptop and a phone arming the same card give
// one notification, not two. Everything here is pure; the network and
// storage side lives in ntfy-sync.ts.

/** A card as the reminder code needs it, read from the metadata cache. */
export interface ReminderCard {
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

/** A reminder this device cancelled; `done` is false while the DELETE still has to go out. */
export interface CancelledEntry {
  at: number;
  target: string;
  done: boolean;
}

export interface NtfyState {
  armed: Record<string, ArmedEntry>;
  cancelled: Record<string, CancelledEntry>;
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

/** Due date + `HH:MM` in local time, or null when either does not parse. */
function dueDate(due: string, time: string): Date | null {
  const d = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return null;
  const h = Number(t[1]), m = Number(t[2]);
  if (h > 23 || m > 59) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, m);
}

/**
 * The reminders that should be scheduled now: one per open card with a
 * `time` and lead, whose fire time lies between "soon enough for ntfy" and
 * the arm-ahead window. Later ones are armed by a later run.
 */
export function desiredReminders(cards: ReminderCard[], leads: number[], now: Date, armHours: number): Reminder[] {
  const nowSec = Math.floor(now.getTime() / 1000);
  const hours = Math.min(MAX_ARM_HOURS, Math.max(1, armHours || 0));
  const until = nowSec + hours * 3600;
  const out: Reminder[] = [];
  for (const card of cards) {
    if (card.status === "done" || !card.time) continue;
    const start = dueDate(card.due, card.time);
    if (!start) continue;
    const startSec = Math.floor(start.getTime() / 1000);
    for (const lead of leads) {
      const at = startSec - lead * 60;
      if (at < nowSec + MIN_DELAY_SEC || at > until) continue;
      out.push({
        seqId: sequenceId(card.id, card.due, lead),
        at,
        title: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
        body: reminderText(card.title, card.project, lead),
        click: card.click,
      });
    }
  }
  return out;
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
 * Posts and deletes that take the server from what this device armed to
 * what it wants now. `force` re-sends everything (see ntfy-sync.ts on why).
 */
export function planSync(state: NtfyState, desired: Reminder[], target: string, nowSec: number, force: boolean): SyncPlan {
  pruneState(state, nowSec);
  const plan: SyncPlan = { posts: [], deletes: [] };
  const wanted = new Set<string>();
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
 * time so it can be repeated when another device brought the reminder back.
 */
export function markCancelled(state: NtfyState, seqId: string, target: string, sent: boolean): void {
  const armed = state.armed[seqId];
  if (armed && armed.target === target) delete state.armed[seqId];
  const prev = state.cancelled[seqId];
  state.cancelled[seqId] = { at: armed?.at ?? prev?.at ?? 0, target, done: sent };
}

/** State read back from localStorage, tolerating anything malformed. */
export function parseState(raw: unknown): NtfyState {
  const state: NtfyState = { armed: {}, cancelled: {} };
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Partial<NtfyState>;
  for (const [id, e] of Object.entries(r.armed ?? {})) {
    if (e && typeof e.hash === "string" && typeof e.at === "number" && typeof e.target === "string") state.armed[id] = e;
  }
  for (const [id, e] of Object.entries(r.cancelled ?? {})) {
    if (e && typeof e.at === "number" && typeof e.target === "string") state.cancelled[id] = { at: e.at, target: e.target, done: e.done === true };
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
