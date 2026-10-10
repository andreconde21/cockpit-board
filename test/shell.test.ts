import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { psq, renderTemplate, shDir, shJoin, shq, slug, splitArgs } from "../src/agent/shell";

const nasty = [`"; touch PWNED; echo "`, "$(whoami)", "`id`", "it's", "a\nb", "$HOME", "\\", "*", ""];

test("shq round-trips every string through sh unchanged", () => {
  for (const s of nasty) {
    const out = execFileSync("sh", ["-c", `printf '%s' ${shq(s)}`]).toString();
    assert.equal(out, s);
  }
});

test("shJoin keeps each word one argument", () => {
  const out = execFileSync("sh", ["-c", `for a in ${shJoin(nasty)}; do printf '[%s]' "$a"; done`]).toString();
  assert.equal(out, nasty.map((s) => `[${s}]`).join(""));
});

test("psq doubles single quotes", () => {
  assert.equal(psq("it's"), "'it''s'");
  assert.equal(psq("$(x)"), "'$(x)'");
});

test("shDir expands a leading ~ and quotes the rest", () => {
  const home = execFileSync("sh", ["-c", "printf %s ~"]).toString();
  assert.equal(execFileSync("sh", ["-c", `printf %s ${shDir("~/a b/$x")}`]).toString(), `${home}/a b/$x`);
  assert.equal(execFileSync("sh", ["-c", `printf %s ${shDir("~")}`]).toString(), home);
  assert.equal(shDir("/srv/x y"), "'/srv/x y'");
});

test("slug", () => {
  assert.equal(slug("CB-12"), "cb-12");
  assert.equal(slug(`"; touch PWNED"`), "touch-pwned");
  assert.equal(slug("Ação é bom"), "acao-e-bom");
  assert.equal(slug("!!!"), "card");
  assert.equal(slug("a".repeat(80)).length, 40);
});

test("splitArgs", () => {
  assert.deepEqual(splitArgs("--model opus  --name \"two words\" \"\""), ["--model", "opus", "--name", "two words", ""]);
  assert.deepEqual(splitArgs(""), []);
  assert.deepEqual(splitArgs("say \\\"hi\\\""), ["say", "\"hi\""]);
});

test("renderTemplate fills known names and leaves others", () => {
  assert.equal(renderTemplate("{{id}} {{ title }} {{nope}}", { id: "CB-1", title: "T" }), "CB-1 T {{nope}}");
  // Values are inserted once, never re-expanded.
  assert.equal(renderTemplate("{{a}}", { a: "{{b}}", b: "x" }), "{{b}}");
});
