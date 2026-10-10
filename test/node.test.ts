import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractMarkedPath, wellKnownBinDirs, type NodeApis } from "../src/node";

const req = createRequire(path.join(process.cwd(), "noop.js"));

test("PATH is read between markers, whatever start-up files print", () => {
  assert.equal(extractMarkedPath("welcome!\n__COCKPIT_PATH__/a:/b__COCKPIT_PATH__\nbye"), "/a:/b");
  assert.equal(extractMarkedPath("no markers"), null);
  assert.equal(extractMarkedPath("__COCKPIT_PATH____COCKPIT_PATH__"), null);
});

test("mise installs without shims are found (herdr on the laptop)", () => {
  const home = mkdtempSync(path.join(tmpdir(), "cockpit-home-"));
  mkdirSync(path.join(home, ".local/share/mise/installs/herdr/latest"), { recursive: true });
  mkdirSync(path.join(home, ".local/bin"), { recursive: true });
  const node = { fs: req("fs"), os: { homedir: () => home } } as unknown as NodeApis;
  const dirs = wellKnownBinDirs(node);
  assert.ok(dirs.includes(path.join(home, ".local/share/mise/installs/herdr/latest")));
  assert.ok(dirs.includes(path.join(home, ".local/bin")));
  assert.ok(!dirs.includes(path.join(home, ".cargo/bin")), "only folders that exist");
});
