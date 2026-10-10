import type { CardDelivery, CockpitBoardSettings, MachineOverride, SessionMode } from "../types";
import { loginEnv, runProcess, type NodeApis } from "../node";

// Machines are not configured in Cockpit: they come from herdr's saved
// machines and the SSH config, plus any added by hand. Settings only hold
// optional overrides per machine name.

export type MachineSource = "herdr" | "ssh" | "manual";

export interface Machine {
  name: string;
  sources: MachineSource[];
  /** herdr machine label, when herdr knows it. */
  herdrLabel?: string;
  /** SSH destination from herdr's profile, when it reports one. */
  herdrDestination?: string;
}

/** A machine with its overrides applied and defaults filled in. */
export interface ResolvedMachine {
  name: string;
  herdrLabel: string;
  sshTarget: string;
  cwd: string;
  agentId: string;
  sessionMode: SessionMode;
  delivery: CardDelivery;
  sharedLocal: string;
  sharedRemote: string;
}

export const EMPTY_OVERRIDE: MachineOverride = {
  sshTarget: "", cwd: "", agentId: "", sessionMode: "", delivery: "", sharedLocal: "", sharedRemote: "", hidden: false,
};

/** `Host` names from an ssh_config file, without patterns (*, ?, !). */
export function parseSshConfigHosts(text: string): string[] {
  const hosts: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^host\s+(.+)$/i);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) {
      if (!name || /[*?!]/.test(name)) continue;
      if (!hosts.includes(name)) hosts.push(name);
    }
  }
  return hosts;
}

interface HerdrMachineJson { label?: unknown; name?: unknown; id?: unknown; destination?: unknown; ssh?: unknown; target?: unknown; host?: unknown; enabled?: unknown }

/**
 * `herdr machine list --json`. Tolerant of the exact shape: a bare array, or
 * an object with `machines` (optionally under `result`).
 */
export function parseHerdrMachines(json: string): { label: string; destination?: string }[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const obj = data as { machines?: unknown; result?: { machines?: unknown } } | null;
  const list: unknown = Array.isArray(data) ? data : obj?.machines ?? obj?.result?.machines;
  if (!Array.isArray(list)) return [];
  const out: { label: string; destination?: string }[] = [];
  for (const item of list as HerdrMachineJson[]) {
    if (!item || typeof item !== "object" || item.enabled === false) continue;
    const label = [item.label, item.name, item.id].find((v): v is string => typeof v === "string" && v.length > 0);
    if (!label) continue;
    const dest = [item.destination, item.ssh, item.target, item.host].find((v): v is string => typeof v === "string" && v.length > 0);
    out.push(dest ? { label, destination: dest } : { label });
  }
  return out;
}

/** Merge the three sources by name, keeping first-seen order: herdr, ssh, manual. */
export function mergeMachines(
  herdr: { label: string; destination?: string }[],
  sshHosts: string[],
  manual: string[],
): Machine[] {
  const byName = new Map<string, Machine>();
  const get = (name: string): Machine => {
    let m = byName.get(name);
    if (!m) { m = { name, sources: [] }; byName.set(name, m); }
    return m;
  };
  for (const h of herdr) {
    const m = get(h.label);
    m.sources.push("herdr");
    m.herdrLabel = h.label;
    if (h.destination) m.herdrDestination = h.destination;
  }
  // An SSH host that a herdr machine already points at is that machine
  // (herdr "dev" with target "development-central"), not a second entry.
  const herdrTargets = new Map<string, Machine>();
  for (const m of byName.values()) if (m.herdrDestination) herdrTargets.set(m.herdrDestination, m);
  for (const host of sshHosts) {
    const viaHerdr = herdrTargets.get(host);
    if (viaHerdr) { if (!viaHerdr.sources.includes("ssh")) viaHerdr.sources.push("ssh"); continue; }
    get(host).sources.push("ssh");
  }
  for (const name of manual.map((n) => n.trim()).filter(Boolean)) {
    const m = get(name);
    if (!m.sources.includes("manual")) m.sources.push("manual");
  }
  return [...byName.values()];
}

/** Apply a machine's overrides; empty fields fall back to defaults. */
export function resolveMachine(m: Machine, settings: CockpitBoardSettings): ResolvedMachine {
  const o = { ...EMPTY_OVERRIDE, ...(settings.machineOverrides[m.name] || {}) };
  const sharedLocal = o.sharedLocal.trim();
  const sharedRemote = o.sharedRemote.trim();
  const hasShared = !!sharedLocal && !!sharedRemote;
  return {
    name: m.name,
    herdrLabel: m.herdrLabel ?? "",
    sshTarget: o.sshTarget.trim() || m.herdrDestination || m.name,
    cwd: o.cwd.trim(),
    agentId: o.agentId || settings.defaultAgentId,
    sessionMode: o.sessionMode || (m.herdrLabel ? "herdr" : "terminal"),
    delivery: o.delivery === "shared" && !hasShared ? "upload" : (o.delivery || (hasShared ? "shared" : "upload")),
    sharedLocal,
    sharedRemote,
  };
}

/** Read every source. Errors in one source never hide the others. */
export async function discoverMachines(node: NodeApis, settings: CockpitBoardSettings): Promise<Machine[]> {
  const env = await loginEnv(node);
  let herdr: { label: string; destination?: string }[] = [];
  const herdrCmd = settings.agentLocal.herdrPath || "herdr";
  const r = await runProcess(node, herdrCmd, ["machine", "list", "--json"], { env, timeoutMs: 5000 });
  if (r.code === 0) herdr = parseHerdrMachines(r.stdout);

  let sshHosts: string[] = [];
  try {
    const file = node.path.join(node.os.homedir(), ".ssh", "config");
    sshHosts = parseSshConfigHosts(await node.fs.promises.readFile(file, "utf8"));
  } catch { /* no ssh config */ }

  return mergeMachines(herdr, sshHosts, settings.manualMachines)
    .filter((m) => !settings.machineOverrides[m.name]?.hidden);
}

/** Every machine including hidden ones, for the settings list. */
export async function discoverAllMachines(node: NodeApis, settings: CockpitBoardSettings): Promise<Machine[]> {
  return discoverMachines(node, { ...settings, machineOverrides: {} });
}
