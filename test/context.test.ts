import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeApp } from "./fake-app";
import { buildContext, formatReference } from "../src/agent/context";

const card = "---\ntitle: Fix login\nproject: Acme\nstatus: in-progress\ndue: 2026-10-10\ntime: 14:00\nlabels: [Work, DEADLINE]\nid: CB-12\n---\n\n# Fix login\n\nUsers get logged out.\n";

test("context block has title, ID, path, board link, status and body", async () => {
  const { app, file } = fakeApp({ "Tasks/fix-login.md": card }, { vaultName: "My Vault", base: "/home/me/Vault" });
  const ctx = await buildContext(app, file("Tasks/fix-login.md"));
  assert.equal(ctx, [
    "Card: [Acme] Fix login",
    "ID: CB-12",
    "Path: /home/me/Vault/Tasks/fix-login.md",
    "Board link: obsidian://cockpit-board?vault=My%20Vault&card=CB-12",
    "Status: in-progress · Due: 2026-10-10 14:00 · Labels: Work, DEADLINE",
    "",
    "# Fix login\n\nUsers get logged out.",
  ].join("\n"));
});

test("context can point at a remote copy and leave the body out", async () => {
  const { app, file } = fakeApp({ "Tasks/fix-login.md": card });
  const ctx = await buildContext(app, file("Tasks/fix-login.md"), { cardFile: "~/.cache/cockpit-board/cards/cb-12.md", includeBody: false });
  assert.match(ctx, /^Card file: ~\/\.cache\/cockpit-board\/cards\/cb-12\.md$/m);
  assert.doesNotMatch(ctx, /^Path:/m);
  assert.doesNotMatch(ctx, /logged out/);
});

test("reference formats", async () => {
  const { app, file } = fakeApp({ "Tasks/fix-login.md": card });
  const f = file("Tasks/fix-login.md");
  assert.equal(await formatReference(app, f, "id"), "CB-12");
  assert.equal(await formatReference(app, f, "path"), "Tasks/fix-login.md");
  assert.equal(await formatReference(app, f, "wikilink"), "[[fix-login]]");
  assert.equal(await formatReference(app, f, "obsidianUri"), "obsidian://open?vault=My%20Vault&file=Tasks%2Ffix-login.md");
  assert.equal(await formatReference(app, f, "title"), "[Acme] Fix login");
});
