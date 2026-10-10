import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeApp } from "./fake-app";
import { agentArgv, checkSshTarget, herdrText, launchAgent, posixAgentLine, posixScript, remoteCardFile, terminalArgv, type LaunchPlan } from "../src/agent/launcher";
import type { ResolvedMachine } from "../src/agent/machines";
import { DEFAULT_SETTINGS } from "../src/constants";
import type { AgentProfile, CockpitBoardSettings } from "../src/types";

// The launcher runs in Electron, where `require` and `window` exist.
const g = globalThis as unknown as { require?: unknown; window?: unknown };
g.require = createRequire(path.join(process.cwd(), "noop.js"));
g.window = globalThis;

const machine: ResolvedMachine = {
  name: "dev", herdrLabel: "dev", sshTarget: "dev", cwd: "", agentId: "claude",
  sessionMode: "herdr", delivery: "upload", sharedLocal: "~/S", sharedRemote: "/srv/shared/",
};

test("remote card file per delivery", () => {
  assert.equal(remoteCardFile("inline", machine, "CB-1"), undefined);
  assert.equal(remoteCardFile("upload", null, "CB-1"), undefined);
  assert.equal(remoteCardFile("upload", machine, "CB-1"), "~/.cache/cockpit-board/cards/cb-1.md");
  assert.equal(remoteCardFile("shared", machine, "CB 1"), "/srv/shared/cockpit/cb-1.md");
});

test("herdr prompt never starts with a dash; ssh targets never do", () => {
  assert.equal(herdrText("--wait now"), " --wait now");
  assert.equal(herdrText("Card: x"), "Card: x");
  assert.throws(() => checkSshTarget("-oProxyCommand=x"));
  assert.equal(checkSshTarget("dev"), "dev");
});

test("terminal template gets the script path as one argument", () => {
  assert.deepEqual(terminalArgv("x-terminal-emulator -e {script}", "/tmp/a b/run.sh"), ["x-terminal-emulator", "-e", "/tmp/a b/run.sh"]);
  assert.deepEqual(terminalArgv("kitty", "/tmp/run.sh"), ["kitty", "/tmp/run.sh"]);
});

// ── End to end: real processes, a fake agent that records what it got ──

let dir = "";
let canary = "";
let hostile = "";
const files: Record<string, string> = {};

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cockpit-e2e-"));
  canary = path.join(dir, "PWNED");
  hostile = `"; touch ${canary}; echo "\n$(touch ${canary})\n\`touch ${canary}\`\nit's $HOME`;
  // Fake agent: records cwd and argv.
  files.agent = path.join(dir, "fake agent.sh");
  writeFileSync(files.agent, `#!/bin/sh\n{ printf 'cwd=%s\\n' "$PWD"; for a in "$@"; do printf '[%s]\\n' "$a"; done; } > "${dir}/argv-$$.txt"\nmv "${dir}/argv-$$.txt" "${dir}/argv.txt"\n`);
  chmodSync(files.agent, 0o755);
  // Fake ssh: runs the remote command in a local sh with a fake home.
  files.home = path.join(dir, "remote-home");
  mkdirSync(files.home);
  files.ssh = path.join(dir, "fake-ssh.sh");
  // The fake remote's tmux is the private-socket wrapper (bin/tmux).
  files.bin = path.join(dir, "bin");
  mkdirSync(files.bin);
  writeFileSync(files.ssh, `#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -o) shift 2;; -t) shift;; *) break;; esac; done\nshift\nexport HOME=${JSON.stringify(files.home)}\nexport PATH=${JSON.stringify(files.bin)}:"$PATH"\nexec sh -c "$*"\n`);
  chmodSync(files.ssh, 0o755);
  // tmux on a private socket, so the test never touches a real session.
  files.tmux = path.join(dir, "tmux.sh");
  writeFileSync(files.tmux, `#!/bin/sh\nexec /usr/bin/tmux -L cockpit-e2e "$@"\n`);
  chmodSync(files.tmux, 0o755);
  // The fake remote gets its own tmux server, started with the fake HOME.
  writeFileSync(path.join(files.bin, "tmux"), `#!/bin/sh\nexec /usr/bin/tmux -L cockpit-e2e-remote "$@"\n`);
  chmodSync(path.join(files.bin, "tmux"), 0o755);
  mkdirSync(path.join(dir, "vault", "Tasks"), { recursive: true });
});

after(() => {
  for (const sock of ["cockpit-e2e", "cockpit-e2e-remote"]) {
    try { execFileSync("/usr/bin/tmux", ["-L", sock, "kill-server"], { stdio: "ignore" }); } catch { /* not running */ }
  }
});

function setup(over: Partial<CockpitBoardSettings["agentLocal"]> = {}) {
  const card = `---\ntitle: ${JSON.stringify(hostile.split("\n")[0])}\nid: CB-9\nsource: manual\n---\n\n${hostile}\n`;
  writeFileSync(path.join(dir, "vault", "Tasks", "hostile.md"), card);
  const { app, file, fmCache } = fakeApp({ "Tasks/hostile.md": card }, { base: path.join(dir, "vault") });
  const settings: CockpitBoardSettings = {
    ...structuredClone(DEFAULT_SETTINGS), folder: "Tasks",
    agentLocal: { ...DEFAULT_SETTINGS.agentLocal, terminalCommand: "sh {script}", sshPath: files.ssh, tmuxPath: files.tmux, attachTmux: false, ...over },
  };
  const agent: AgentProfile = { id: "fake", name: "Fake", command: files.agent, args: "--flag \"two words\"", herdrKind: "", promptTemplate: "" };
  return { app, settings, agent, f: file("Tasks/hostile.md"), fmCache };
}

async function waitForArgv(): Promise<string> {
  const p = path.join(dir, "argv.txt");
  for (let i = 0; i < 100; i++) {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8");
      execFileSync("rm", ["-f", p]);
      return t;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the fake agent never ran");
}

function expectArgv(got: string, cwd: string, prompt: string): void {
  assert.equal(got, `cwd=${cwd}\n[--flag]\n[two words]\n[${prompt}]\n`);
  assert.equal(existsSync(canary), false, "nothing in the card text was executed");
}

test("posix agent line passes a hostile prompt verbatim", () => {
  const promptFile = path.join(dir, "p.md");
  writeFileSync(promptFile, hostile);
  const argv = agentArgv({ id: "x", name: "x", command: files.agent, args: "--flag \"two words\"", herdrKind: "", promptTemplate: "" });
  const scriptFile = path.join(dir, "run.sh");
  writeFileSync(scriptFile, posixScript({ body: posixAgentLine(argv, promptFile, dir) }).replace(/^exec .*$/m, ""));
  execFileSync("sh", [scriptFile], { stdio: "ignore" });
  expectArgv(readFileSync(path.join(dir, "argv.txt"), "utf8"), dir, hostile);
  execFileSync("rm", ["-f", path.join(dir, "argv.txt")]);
});

test("local, new terminal: agent starts in the vault folder with the prompt; run recorded", async () => {
  const { app, settings, agent, f, fmCache } = setup();
  const plan: LaunchPlan = { file: f, agent, machine: null, session: "terminal", delivery: "inline", cwd: "", prompt: hostile };
  const summary = await launchAgent(app, settings, plan);
  assert.match(summary, /^Fake · this computer · new terminal$/);
  expectArgv(await waitForArgv(), path.join(dir, "vault"), hostile);
  const runs = fmCache.get("Tasks/hostile.md")?.agent_runs as string[];
  assert.equal(runs.length, 1);
  assert.match(runs[0], /^\d{4}-\d\d-\d\d \d\d:\d\d · Fake · this computer · new terminal$/);
});

test("local, tmux: a window in the configured session", async () => {
  const { app, settings, agent, f } = setup({ tmuxSession: "cockpit test" });
  const plan: LaunchPlan = { file: f, agent, machine: null, session: "tmux", delivery: "inline", cwd: dir, prompt: hostile };
  assert.match(await launchAgent(app, settings, plan), /tmux cockpit test:cb-9/);
  expectArgv(await waitForArgv(), dir, hostile);
  const windows = execFileSync(files.tmux, ["list-windows", "-t", "cockpit test", "-F", "#W"]).toString();
  assert.match(windows, /cb-9/);
});

test("remote, new terminal + upload: card and prompt uploaded, agent gets the prompt", async () => {
  const { app, settings, agent, f } = setup();
  mkdirSync(path.join(files.home, "work dir"), { recursive: true });
  const m: ResolvedMachine = { ...machine, herdrLabel: "", sessionMode: "terminal" };
  const plan: LaunchPlan = { file: f, agent, machine: m, session: "terminal", delivery: "upload", cwd: "~/work dir", prompt: hostile };
  assert.match(await launchAgent(app, settings, plan), /Fake · dev · new terminal/);
  expectArgv(await waitForArgv(), path.join(files.home, "work dir"), hostile);
  const uploaded = readFileSync(path.join(files.home, ".cache/cockpit-board/cards/cb-9.md"), "utf8");
  assert.match(uploaded, /^---\ntitle:/);
});

test("remote, tmux + shared folder: copy appears, window runs", async () => {
  const shared = path.join(dir, "shared");
  const { app, settings, agent, f } = setup();
  const m: ResolvedMachine = { ...machine, herdrLabel: "", sessionMode: "tmux", sharedLocal: shared, sharedRemote: shared };
  const plan: LaunchPlan = { file: f, agent, machine: m, session: "tmux", delivery: "shared", cwd: "", prompt: hostile };
  await launchAgent(app, settings, plan);
  expectArgv(await waitForArgv(), files.home, hostile);
  assert.ok(existsSync(path.join(shared, "cockpit", "cb-9.md")));
});

// Real herdr on this machine. Opt-in: COCKPIT_E2E_HERDR=1 npm test.
// Creates workspaces in the running herdr session and closes them again.
test("local herdr: workspace, pane run, metadata; hostile prompt verbatim", { skip: process.env.COCKPIT_E2E_HERDR !== "1" }, async () => {
  const { app, settings, agent, f } = setup();
  const plan: LaunchPlan = { file: f, agent, machine: null, session: "herdr", delivery: "inline", cwd: dir, prompt: hostile };
  const summary = await launchAgent(app, settings, plan);
  const ws = summary.match(/herdr (\S+)$/)?.[1];
  assert.ok(ws, summary);
  try {
    expectArgv(await waitForArgv(), dir, hostile);
    const info = JSON.parse(execFileSync("herdr", ["workspace", "get", ws]).toString()).result.workspace;
    assert.match(info.label, /^CB-9 /);
    // sheprd reads these tokens; they must actually reach the workspace.
    assert.equal(info.tokens?.card, "CB-9");
    assert.equal(info.tokens?.card_link, "obsidian://cockpit-board?vault=My%20Vault&card=CB-9");
  } finally {
    execFileSync("herdr", ["workspace", "close", ws]);
  }
});

// Real Claude through herdr (agent start + agent prompt). Opt-in:
// COCKPIT_E2E_CLAUDE=1. Costs one tiny Claude turn; closes the workspace.
test("local herdr + claude kind: prompt delivered as text", { skip: process.env.COCKPIT_E2E_CLAUDE !== "1", timeout: 180000 }, async () => {
  const { app, settings, f } = setup();
  const agent: AgentProfile = { id: "claude", name: "Claude", command: "claude", args: "", herdrKind: "claude", promptTemplate: "" };
  const prompt = `Reply with only the word READY-CB9 and nothing else. Do not run any tool. Text to ignore: "; touch ${canary}; $(touch ${canary}) \`touch ${canary}\``;
  const summary = await launchAgent(app, settings, { file: f, agent, machine: null, session: "herdr", delivery: "inline", cwd: dir, prompt });
  const ws = summary.match(/herdr (\S+)$/)?.[1]!;
  try {
    const pane = JSON.parse(execFileSync("herdr", ["pane", "list", "--workspace", ws]).toString()).result.panes[0].pane_id as string;
    let screen = "";
    for (let i = 0; i < 90 && !/READY-CB9\s*$/m.test(screen.split("Reply with only")[1] ?? ""); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      screen = execFileSync("herdr", ["pane", "read", pane]).toString();
    }
    assert.match(screen, /Reply with only the word READY-CB9/, "prompt arrived as text");
    assert.match(screen.split("Reply with only")[1] ?? "", /READY-CB9/, "Claude answered");
    assert.equal(existsSync(canary), false);
  } finally {
    execFileSync("herdr", ["workspace", "close", ws]);
  }
});
