import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCancels, desiredReminders, emptyState, hasPending, markCancelled, markPosted, mayCarryToken, ntfyTarget,
  parseState, planSync, sequenceId, snapshotCards, staleReminders, withUniqueIds,
  type NtfyState, type ReminderCard,
} from "../src/ntfy";

const SEQ = /^[-_A-Za-z0-9]{1,64}$/;
const T = "https://ntfy.example.com/cockpit";
// 2026-10-10 09:00 local time.
const now = new Date(2026, 9, 10, 9, 0);
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

const card = (over: Partial<ReminderCard> = {}): ReminderCard => ({
  path: "Tasks/standup.md", id: "CB-12", title: "Standup", project: "Acme", status: "", due: "2026-10-10", time: "10:30",
  click: "obsidian://cockpit-board?vault=V&card=CB-12", ...over,
});
const empty = (): NtfyState => emptyState();

test("sequence IDs: plain card IDs kept, others slugged with a hash, always valid for ntfy", () => {
  assert.equal(sequenceId("CB-12", "2026-10-10", 15), "cb-CB-12-2026-10-10-15");
  const a = sequenceId("Call: Ana", "2026-10-10", 1);
  const b = sequenceId("Call? Ana", "2026-10-10", 1);
  assert.match(a, /^cb-Call-Ana-[0-9a-f]{8}-2026-10-10-1$/);
  assert.notEqual(a, b);
  for (const id of ["x".repeat(200), "Reunião com o Zé às 10h — sala 2 ".repeat(5), "???", "a/b/c"]) {
    const s = sequenceId(id, "2026-10-10", 1440);
    assert.match(s, SEQ, s);
    assert.ok(s.endsWith("-2026-10-10-1440"));
  }
  assert.notEqual(sequenceId("x".repeat(100) + "a", "2026-10-10", 1), sequenceId("x".repeat(100) + "b", "2026-10-10", 1));
});

test("desired reminders: one per lead still ahead, same body as the in-app notice", () => {
  const rs = desiredReminders([card()], [15, 1], now, 24);
  assert.deepEqual(rs.map((r) => r.seqId), ["cb-CB-12-2026-10-10-15", "cb-CB-12-2026-10-10-1"]);
  assert.equal(rs[0].at, sec(new Date(2026, 9, 10, 10, 15)));
  assert.equal(rs[1].at, sec(new Date(2026, 9, 10, 10, 29)));
  assert.equal(rs[0].body, "[Acme] Standup starts in 15 minutes");
  assert.equal(rs[1].body, "[Acme] Standup starts in 1 minute");
  assert.equal(rs[0].title, "10:30");
  assert.equal(rs[0].click, "obsidian://cockpit-board?vault=V&card=CB-12");
});

test("desired reminders skip done, untimed, past, too-soon and out-of-window cards", () => {
  const cards = [
    card({ id: "done", status: "done" }),
    card({ id: "allday", time: "" }),
    card({ id: "past", time: "08:00" }),
    card({ id: "soon", time: "09:15" }), // 15-min lead fires now: too late for ntfy; 1-min lead still ahead
    card({ id: "tomorrow", due: "2026-10-11", time: "08:00" }),
    card({ id: "later", due: "2026-10-12", time: "08:00" }),
    card({ id: "junk", time: "noon" }),
  ];
  const ids = desiredReminders(cards, [15, 1], now, 24).map((r) => r.seqId);
  assert.deepEqual(ids, ["cb-soon-2026-10-10-1", "cb-tomorrow-2026-10-11-15", "cb-tomorrow-2026-10-11-1"]);
  // A window of 1 hour leaves tomorrow for a later run; it is clamped to ntfy's 3 days.
  assert.deepEqual(desiredReminders(cards, [15, 1], now, 1).map((r) => r.seqId), ["cb-soon-2026-10-10-1"]);
  assert.equal(desiredReminders([card({ due: "2026-10-14" })], [15], now, 1000).length, 0);
});

test("plan: post new, skip unchanged, re-post changed, delete unwanted", () => {
  const state = empty();
  const n = sec(now);
  let desired = desiredReminders([card()], [15, 1], now, 24);
  let plan = planSync(state, desired, T, n, false);
  assert.equal(plan.posts.length, 2);
  assert.equal(plan.deletes.length, 0);
  for (const r of plan.posts) markPosted(state, r, T);

  // Nothing changed: nothing to send.
  plan = planSync(state, desired, T, n, false);
  assert.deepEqual(plan, { posts: [], deletes: [] });
  // The periodic re-send posts everything again.
  assert.equal(planSync(state, desired, T, n, true).posts.length, 2);

  // Retimed: same IDs, new fire time, so they are replaced, not deleted.
  desired = desiredReminders([card({ time: "11:00" })], [15, 1], now, 24);
  plan = planSync(state, desired, T, n, false);
  assert.equal(plan.posts.length, 2);
  assert.equal(plan.deletes.length, 0);
  for (const r of plan.posts) markPosted(state, r, T);

  // Lead removed, then card done or deleted: cancelled.
  plan = planSync(state, desiredReminders([card({ time: "11:00" })], [15], now, 24), T, n, false);
  assert.deepEqual(plan.deletes, [{ seqId: "cb-CB-12-2026-10-10-1", target: T }]);
  plan = planSync(state, desiredReminders([card({ time: "11:00", status: "done" })], [15, 1], now, 24), T, n, false);
  assert.equal(plan.deletes.length, 2);
  assert.equal(plan.posts.length, 0);
});

test("plan: re-dated card cancels the old date's IDs and posts the new ones", () => {
  const state = empty();
  const n = sec(now);
  for (const r of desiredReminders([card()], [15], now, 24)) markPosted(state, r, T);
  const plan = planSync(state, desiredReminders([card({ due: "2026-10-11", time: "08:00" })], [15], now, 24), T, n, false);
  assert.deepEqual(plan.posts.map((r) => r.seqId), ["cb-CB-12-2026-10-11-15"]);
  assert.deepEqual(plan.deletes, [{ seqId: "cb-CB-12-2026-10-10-15", target: T }]);
});

test("plan: fired reminders are forgotten, never deleted", () => {
  const state = empty();
  for (const r of desiredReminders([card()], [15], now, 24)) markPosted(state, r, T);
  const after = sec(new Date(2026, 9, 10, 10, 20));
  assert.deepEqual(planSync(state, [], T, after, false), { posts: [], deletes: [] });
  assert.deepEqual(state.armed, {});
});

test("plan: failed deletes are retried, sent ones repeated only on the re-send", () => {
  const state = empty();
  const n = sec(now);
  const [r] = desiredReminders([card()], [15], now, 24);
  markPosted(state, r, T);
  markCancelled(state, r.seqId, T, false);
  assert.deepEqual(state.armed, {});
  assert.deepEqual(planSync(state, [], T, n, false).deletes, [{ seqId: r.seqId, target: T }]);
  markCancelled(state, r.seqId, T, true);
  assert.equal(planSync(state, [], T, n, false).deletes.length, 0);
  // Another device may have put it back: the re-send cancels it again.
  assert.equal(planSync(state, [], T, n, true).deletes.length, 1);
  // Wanted again (card reopened): posted, and no longer a cancellation.
  const plan = planSync(state, [r], T, n, false);
  assert.equal(plan.posts.length, 1);
  assert.equal(plan.deletes.length, 0);
  markPosted(state, r, T);
  assert.deepEqual(state.cancelled, {});
});

test("plan: a new server or topic posts there and cancels the old copy", () => {
  const state = empty();
  const desired = desiredReminders([card()], [15], now, 24);
  for (const r of desired) markPosted(state, r, T);
  const other = "https://ntfy.example.com/other";
  const plan = planSync(state, desired, other, sec(now), false);
  assert.equal(plan.posts.length, 1);
  assert.deepEqual(plan.deletes, [{ seqId: desired[0].seqId, target: T }]);
});

test("stored state is read defensively", () => {
  assert.deepEqual(parseState(null), empty());
  assert.deepEqual(parseState("junk"), empty());
  const s = parseState({ armed: { a: { hash: "h", at: 1, target: T }, b: { at: "x" } }, cancelled: { c: { at: 2, target: T } }, seen: { p: { id: "x", due: "d", time: "t" }, q: 3 } });
  assert.deepEqual(Object.keys(s.armed), ["a"]);
  assert.deepEqual(s.cancelled.c, { at: 2, target: T, done: false });
  assert.deepEqual(s.seen, { p: { id: "x", due: "d", time: "t", done: false } });
});

test("target needs an http(s) server and a valid topic", () => {
  assert.equal(ntfyTarget(" https://ntfy.sh/ ", "cockpit"), "https://ntfy.sh/cockpit");
  assert.equal(ntfyTarget("", "cockpit"), "");
  assert.equal(ntfyTarget("ntfy.sh", "cockpit"), "");
  assert.equal(ntfyTarget("https://ntfy.sh", "my topic"), "");
});

// Another device posted these; this one only ever saw the cards.
const stale = (before: ReminderCard[], after: ReminderCard[], at = now) =>
  staleReminders(snapshotCards(before), after, desiredReminders(after, [15, 1], at, 24), [15, 1], at, 24).map((r) => r.seqId).sort();

test("stale reminders: a card done elsewhere cancels its own future reminders, never fired ones", () => {
  assert.deepEqual(stale([], [card({ status: "done" })]), ["cb-CB-12-2026-10-10-1", "cb-CB-12-2026-10-10-15"]);
  // 10:20: the 15-minute reminder fired at 10:15 and is left alone.
  assert.deepEqual(stale([], [card({ status: "done" })], new Date(2026, 9, 10, 10, 20)), ["cb-CB-12-2026-10-10-1"]);
  assert.deepEqual(stale([], [card({ status: "done", due: "2026-10-09" })]), []);
});

test("stale reminders: re-dated, deleted or moved cards cancel the old date's IDs", () => {
  const before = [card()];
  assert.deepEqual(stale(before, [card({ due: "2026-10-11" })]), ["cb-CB-12-2026-10-10-1", "cb-CB-12-2026-10-10-15"]);
  assert.deepEqual(stale(before, []), ["cb-CB-12-2026-10-10-1", "cb-CB-12-2026-10-10-15"]);
  assert.deepEqual(stale(before, [card({ time: "" })]), ["cb-CB-12-2026-10-10-1", "cb-CB-12-2026-10-10-15"]);
  // ID changed (an id was assigned): the old IDs go, the new ones are posted.
  assert.deepEqual(stale(before, [card({ id: "CB-99" })]), ["cb-CB-12-2026-10-10-1", "cb-CB-12-2026-10-10-15"]);
});

test("stale reminders: retimed on the same day keeps its IDs (replaced by a post), unchanged cards cancel nothing", () => {
  assert.deepEqual(stale([card()], [card({ time: "11:00" })]), []);
  assert.deepEqual(stale([card()], [card()]), []);
  // Renamed file, same ID and time: same reminders, nothing to cancel.
  assert.deepEqual(stale([card()], [card({ path: "Tasks/other.md" })]), []);
  // Retimed so the 15-minute reminder is now too close: only that one goes.
  assert.deepEqual(stale([card()], [card({ time: "09:10" })]), ["cb-CB-12-2026-10-10-15"]);
});

test("cancellations are queued once, sent before anything is re-sent, and kept until sent", () => {
  const state = empty();
  const n = sec(now);
  addCancels(state, [{ seqId: "cb-x-2026-10-10-15", at: n + 600 }], T);
  addCancels(state, [{ seqId: "cb-x-2026-10-10-15", at: n + 600 }], T);
  assert.ok(hasPending(state));
  assert.deepEqual(planSync(state, [], T, n, false).deletes, [{ seqId: "cb-x-2026-10-10-15", target: T }]);
  markCancelled(state, "cb-x-2026-10-10-15", T, true);
  assert.ok(!hasPending(state));
  addCancels(state, [{ seqId: "cb-x-2026-10-10-15", at: n + 600 }], T);
  assert.equal(planSync(state, [], T, n, false).deletes.length, 0);
});

test("turned off: planning with nothing desired undoes everything this device armed", () => {
  const state = empty();
  for (const r of desiredReminders([card()], [15, 1], now, 24)) markPosted(state, r, T);
  const plan = planSync(state, [], "", sec(now), false);
  assert.equal(plan.posts.length, 0);
  assert.deepEqual(plan.deletes.map((d) => d.target), [T, T]);
  markCancelled(state, plan.deletes[0].seqId, T, true);
  markCancelled(state, plan.deletes[1].seqId, T, false);
  assert.ok(hasPending(state));
  assert.equal(planSync(state, [], "", sec(now), false).deletes.length, 1);
});

test("duplicate card IDs get their path folded in, so they don't share reminders", () => {
  const cards = withUniqueIds([card(), card({ path: "Tasks/b.md" }), card({ id: "CB-13", path: "Tasks/c.md" })]);
  assert.deepEqual(cards.map((c) => c.id), ["CB-12@Tasks/standup.md", "CB-12@Tasks/b.md", "CB-13"]);
  const ids = desiredReminders(cards, [15], now, 24).map((r) => r.seqId);
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.match(id, SEQ);
});

test("the token only travels over https or to localhost", () => {
  assert.ok(mayCarryToken("https://ntfy.sh/cockpit"));
  assert.ok(mayCarryToken("http://localhost:8080/cockpit"));
  assert.ok(mayCarryToken("http://127.0.0.1/cockpit"));
  assert.ok(!mayCarryToken("http://ntfy.example.com/cockpit"));
  assert.ok(!mayCarryToken("http://localhost.evil.com/cockpit"));
});
