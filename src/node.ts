// Node access for desktop-only features. Electron provides `require` on
// desktop; on mobile it does not exist, and every caller gets null and must
// treat the feature as unavailable.

type NodeRequire = (mod: string) => unknown;

/* global require -- Electron provides require on desktop; the typeof guard below keeps mobile safe */
export function nodeRequire(): NodeRequire | null {
  try {
    return (typeof require === "function" ? require : null) as NodeRequire | null;
  } catch {
    return null;
  }
}

// The slice of Node the plugin uses, declared here rather than taken from
// @types/node: the directory scorecard lints without dev dependencies, and
// `typeof import("fs")` then comes out as an error type at every use.
type Env = Record<string, string | undefined>;

interface Stream {
  on(event: "data", cb: (d: { toString(): string }) => void): void;
}

export interface ChildProcess {
  stdout: Stream | null;
  stderr: Stream | null;
  stdin: { end(data?: string): void } | null;
  on(event: "error", cb: (e: Error & { code?: string }) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
  once(event: "error", cb: (e: Error & { code?: string }) => void): void;
  once(event: "spawn", cb: () => void): void;
  kill(): void;
  unref(): void;
}

interface SpawnOptions {
  cwd?: string;
  env?: Env;
  shell?: boolean;
  windowsHide?: boolean;
  detached?: boolean;
  stdio?: "ignore";
}

interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
  mtimeMs: number;
}

type WriteOptions = "utf8" | { encoding: "utf8"; mode?: number };

export interface NodeApis {
  cp: { spawn(cmd: string, args: string[], opts: SpawnOptions): ChildProcess };
  fs: {
    existsSync(p: string): boolean;
    readdirSync(p: string): string[];
    statSync(p: string): Stats;
    promises: {
      mkdir(p: string, opts: { recursive: boolean; mode?: number }): Promise<unknown>;
      readdir(p: string): Promise<string[]>;
      readFile(p: string, enc: "utf8"): Promise<string>;
      rm(p: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
      stat(p: string): Promise<Stats>;
      writeFile(p: string, data: string, opts: WriteOptions): Promise<void>;
    };
  };
  os: { homedir(): string; tmpdir(): string };
  path: { join(...parts: string[]): string };
  process: { env: Env; platform: string };
}

/** The Node modules the launcher uses, or null on mobile. */
export function nodeApis(): NodeApis | null {
  const req = nodeRequire();
  if (!req) return null;
  try {
    return {
      cp: req("child_process") as NodeApis["cp"],
      fs: req("fs") as NodeApis["fs"],
      os: req("os") as NodeApis["os"],
      path: req("path") as NodeApis["path"],
      process: req("process") as NodeApis["process"],
    };
  } catch {
    return null;
  }
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Written to the process's stdin, then stdin is closed. */
  input?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/**
 * Run a program with an argument list (no shell) and collect its output.
 * A missing program resolves with code 127 and a readable stderr.
 */
export function runProcess(node: NodeApis, cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (r: RunResult) => { if (!done) { done = true; resolve(r); } };
    let child: ChildProcess;
    try {
      child = node.cp.spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true });
    } catch (e: unknown) {
      finish({ code: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = opts.timeoutMs
      ? window.setTimeout(() => { child.kill(); finish({ code: 124, stdout, stderr: stderr || `${cmd} timed out` }); }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (d: { toString(): string }) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: { toString(): string }) => { stderr += d.toString(); });
    child.on("error", (e: Error & { code?: string }) => {
      if (timer) window.clearTimeout(timer);
      finish({ code: e.code === "ENOENT" ? 127 : 1, stdout, stderr: e.code === "ENOENT" ? `${cmd}: command not found` : e.message });
    });
    child.on("close", (code) => {
      if (timer) window.clearTimeout(timer);
      finish({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}

/** Start a program that outlives the call (a terminal window). */
export function startDetached(node: NodeApis, cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = node.cp.spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: "ignore", shell: false });
      child.once("error", (e: Error & { code?: string }) => reject(new Error(e.code === "ENOENT" ? `${cmd}: command not found` : e.message)));
      child.once("spawn", () => { child.unref(); resolve(); });
    } catch (e: unknown) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

let loginEnvCache: Record<string, string | undefined> | null = null;

const PATH_MARK = "__COCKPIT_PATH__";

/** The PATH printed between markers; shell start-up files may print around it. */
export function extractMarkedPath(stdout: string): string | null {
  const m = stdout.match(new RegExp(`${PATH_MARK}(.*?)${PATH_MARK}`, "s"));
  return m && m[1].trim() ? m[1].trim() : null;
}

/**
 * Folders where version managers and installers put programs. Added (when
 * they exist) after the shell's PATH: mise and similar tools often only
 * reach PATH from interactive start-up files.
 */
export function wellKnownBinDirs(node: NodeApis): string[] {
  const home = node.os.homedir();
  const dirs = [
    `${home}/.local/bin`,
    `${home}/.local/share/mise/shims`,
    `${home}/.asdf/shims`,
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.volta/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  // mise without shims: ~/.local/share/mise/installs/<tool>/latest[/bin]
  const installs = `${home}/.local/share/mise/installs`;
  try {
    for (const tool of node.fs.readdirSync(installs)) {
      dirs.push(`${installs}/${tool}/latest`, `${installs}/${tool}/latest/bin`);
    }
  } catch { /* no mise */ }
  return dirs.filter((d) => {
    try { return node.fs.statSync(d).isDirectory(); } catch { return false; }
  });
}

/**
 * The environment with the user's PATH as their terminal has it. Apps
 * started from the dock or a launcher get a minimal PATH and would not find
 * `claude`, `herdr` or `tmux`. Tries an interactive login shell (where mise,
 * nvm and the like set PATH), then a login shell, then well-known folders.
 */
export async function loginEnv(node: NodeApis): Promise<Record<string, string | undefined>> {
  if (loginEnvCache) return loginEnvCache;
  const env: Record<string, string | undefined> = { ...node.process.env };
  if (node.process.platform !== "win32") {
    const shell = env.SHELL || "/bin/sh";
    const print = `printf '%s%s%s' '${PATH_MARK}' "$PATH" '${PATH_MARK}'`;
    let shellPath: string | null = null;
    for (const flags of ["-ilc", "-lc"]) {
      const r = await runProcess(node, shell, [flags, print], { timeoutMs: 5000 });
      shellPath = extractMarkedPath(r.stdout);
      if (shellPath) break;
    }
    const parts = [...(shellPath ?? "").split(":"), ...(env.PATH || "").split(":"), ...wellKnownBinDirs(node)].filter(Boolean);
    env.PATH = [...new Set(parts)].join(":");
  }
  loginEnvCache = env;
  return env;
}

/** Full path of a program on the login PATH, or null. */
export async function which(node: NodeApis, cmd: string): Promise<string | null> {
  const env = await loginEnv(node);
  const win = node.process.platform === "win32";
  if (cmd.includes("/") || (win && cmd.includes("\\"))) return node.fs.existsSync(cmd) ? cmd : null;
  const exts = win ? ["", ...(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())] : [""];
  for (const dir of (env.PATH || "").split(win ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = node.path.join(dir, cmd + ext);
      try {
        if (node.fs.statSync(p).isFile()) return p;
      } catch { /* not here */ }
    }
  }
  return null;
}
