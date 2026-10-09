import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeApp } from "./fake-app";
import { assignMissingIds, cardIdOf, ensureCardId, findDuplicateIds, idNumber, nextCardId, normalizePrefix, resetCopiedId } from "../src/agent/card-id";
import { DEFAULT_SETTINGS } from "../src/constants";
import type { CockpitBoardSettings } from "../src/types";

const settings = (over: Partial<CockpitBoardSettings> = {}): CockpitBoardSettings =>
  ({ ...structuredClone(DEFAULT_SETTINGS), folder: "Tasks", archiveFolder: "Archive", ...over });

test("card ID is the id property, else the basename", () => {
  const { app, file } = fakeApp({
    "Tasks/with-id.md": "---\nid: CB-7\n---\n",
    "Tasks/no-id.md": "---\ntitle: x\n---\n",
  });
  assert.equal(cardIdOf(app, file("Tasks/with-id.md")), "CB-7");
  assert.equal(cardIdOf(app, file("Tasks/no-id.md")), "no-id");
});

test("prefix normalisation and number parsing", () => {
  assert.equal(normalizePrefix("cb"), "CB");
  assert.equal(normalizePrefix(" a-b! "), "AB");
  assert.equal(normalizePrefix("--"), "CB");
  assert.equal(idNumber("CB-12", "CB"), 12);
  assert.equal(idNumber("cb-12", "CB"), 12);
  assert.equal(idNumber("CBX-12", "CB"), null);
  assert.equal(idNumber("CB-12a", "CB"), null);
});

test("next ID is one above the highest in tasks and archive, and never repeats in a burst", () => {
  const { app } = fakeApp({
    "Tasks/a.md": "---\nid: T-3\n---\n",
    "Archive/2026/01/01/b.md": "---\nid: T-9\n---\n",
    "Other/c.md": "---\nid: T-50\n---\n",
  });
  const s = settings({ cardIdPrefix: "t" });
  assert.equal(nextCardId(app, s), "T-10");
  assert.equal(nextCardId(app, s), "T-11");
});

test("ensureCardId only acts when assigning is on and the card has none", async () => {
  const { app, file, fmCache } = fakeApp({ "Tasks/a.md": "---\ntitle: a\n---\n", "Tasks/b.md": "---\nid: KEEP-1\n---\n" });
  await ensureCardId(app, settings({ cardIdPrefix: "E" }), file("Tasks/a.md"));
  assert.equal(fmCache.get("Tasks/a.md")?.id, undefined);
  await ensureCardId(app, settings({ assignCardIds: true, cardIdPrefix: "E" }), file("Tasks/a.md"));
  assert.equal(fmCache.get("Tasks/a.md")?.id, "E-1");
  await ensureCardId(app, settings({ assignCardIds: true, cardIdPrefix: "E" }), file("Tasks/b.md"));
  assert.equal(fmCache.get("Tasks/b.md")?.id, "KEEP-1");
});

test("a copied card never keeps the original's ID", () => {
  const { app } = fakeApp({ "Tasks/a.md": "---\nid: R-4\n---\n" });
  const off: Record<string, unknown> = { id: "R-4" };
  resetCopiedId(app, settings({ cardIdPrefix: "R" }), off);
  assert.equal("id" in off, false);
  const on: Record<string, unknown> = { id: "R-4" };
  resetCopiedId(app, settings({ assignCardIds: true, cardIdPrefix: "R" }), on);
  assert.equal(on.id, "R-5");
});

test("duplicates are found, and assignMissingIds renumbers the newer card and fills gaps", async () => {
  const { app, fmCache } = fakeApp({
    "Tasks/old.md": "---\nid: D-1\ncreated: 2026-01-01\n---\n",
    "Tasks/new.md": "---\nid: D-1\ncreated: 2026-02-01\n---\n",
    "Tasks/none.md": "---\ntitle: none\ncreated: 2026-03-01\n---\n",
  });
  const s = settings({ assignCardIds: true, cardIdPrefix: "D" });
  const dupes = findDuplicateIds(app, s);
  assert.deepEqual([...dupes.keys()], ["D-1"]);
  assert.equal(dupes.get("D-1")![0].path, "Tasks/old.md");
  const changed = await assignMissingIds(app, s);
  assert.equal(changed, 2);
  assert.equal(fmCache.get("Tasks/old.md")?.id, "D-1");
  assert.equal(fmCache.get("Tasks/new.md")?.id, "D-2");
  assert.equal(fmCache.get("Tasks/none.md")?.id, "D-3");
  assert.equal(findDuplicateIds(app, s).size, 0);
});
