// Bundles test/*.test.ts with "obsidian" pointed at test/obsidian-stub.ts and
// runs them with node's built-in test runner. No extra dependencies.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const testDir = path.join(root, "test");
const entries = readdirSync(testDir).filter((f) => f.endsWith(".test.ts")).map((f) => path.join(testDir, f));
const out = mkdtempSync(path.join(tmpdir(), "cockpit-test-"));
try {
  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: out,
    outExtension: { ".js": ".mjs" },
    alias: { obsidian: path.join(testDir, "obsidian-stub.ts") },
    logLevel: "error",
  });
  const files = readdirSync(out).map((f) => path.join(out, f));
  const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
