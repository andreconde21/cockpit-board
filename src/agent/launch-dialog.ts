import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type CockpitBoardPlugin from "../CockpitBoardPlugin";
import type { AgentProfile, CardDelivery, SessionMode } from "../types";
import { nodeApis } from "../node";
import { cardIdOf } from "./card-id";
import { copyText } from "./card-actions";
import { cardTitle } from "./context";
import { LaunchError, launchAgent, localAvailability, remoteCardFile, renderPrompt, type Availability, type LaunchPlan } from "./launcher";
import { discoverMachines, resolveMachine, type ResolvedMachine } from "./machines";

const LOCAL = "";

interface Remembered { agentId: string; machine: string; session: SessionMode; delivery: CardDelivery }

const SESSION_NAMES: Record<SessionMode, string> = { herdr: "Workspace in herdr", terminal: "New terminal", tmux: "Window in tmux" };
const DELIVERY_NAMES: Record<CardDelivery, string> = {
  inline: "In the prompt",
  upload: "Upload over SSH",
  shared: "Copy to shared folder",
};

/** The `agent_cwd:` property of a card, "" when unset. */
export function cardCwd(app: App, file: TFile): string {
  const v: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.agent_cwd;
  return typeof v === "string" ? v.trim() : "";
}

/**
 * "Start agent" dialog: agent, where, how the card gets there, session,
 * folder, and the prompt (editable). Nothing starts until Start is clicked.
 */
export class LaunchDialog extends Modal {
  private machines: ResolvedMachine[] = [];
  private avail: Availability = { herdr: false, tmux: false };
  private agentId: string;
  private machineName = LOCAL;
  private session: SessionMode = "terminal";
  private delivery: CardDelivery = "inline";
  private cwd = "";
  private prompt = "";
  private promptEdited = false;
  private promptEl: HTMLTextAreaElement | null = null;
  private formEl: HTMLElement | null = null;
  private renderSeq = 0;

  constructor(private plugin: CockpitBoardPlugin, private file: TFile, private outside: boolean) {
    super(plugin.app);
    this.agentId = plugin.settings.defaultAgentId;
  }

  private get storageKey(): string { return `cockpit-board-launch:${this.file.path}`; }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("cockpit-launch-modal");
    this.titleEl.setText(`Start agent: ${cardTitle(this.app, this.file)} (${cardIdOf(this.app, this.file)})`);
    this.contentEl.createDiv({ cls: "cockpit-launch-loading", text: "Looking for machines..." });

    const node = nodeApis();
    const s = this.plugin.settings;
    const [avail, machines] = await Promise.all([
      localAvailability(s),
      node ? discoverMachines(node, s).catch(() => []) : Promise.resolve([]),
    ]);
    this.avail = avail;
    this.machines = machines.map((m) => resolveMachine(m, s));

    let remembered: Remembered | null = null;
    try { remembered = this.app.loadLocalStorage(this.storageKey) as Remembered | null; } catch { remembered = null; }
    const r = remembered;
    if (r && s.agentProfiles.some((a) => a.id === r.agentId)) this.agentId = r.agentId;
    if (r && (r.machine === LOCAL || this.machines.some((m) => m.name === r.machine))) {
      this.machineName = r.machine;
    }
    this.applyMachineDefaults();
    if (remembered && remembered.machine === this.machineName) {
      if (this.sessionAllowed(remembered.session)) this.session = remembered.session;
      if (this.deliveryAllowed(remembered.delivery)) this.delivery = remembered.delivery;
    }
    this.renderForm();
    await this.refreshPrompt();
  }

  private get machine(): ResolvedMachine | null {
    return this.machines.find((m) => m.name === this.machineName) ?? null;
  }

  private get agent(): AgentProfile {
    const list = this.plugin.settings.agentProfiles;
    return list.find((a) => a.id === this.agentId) ?? list[0];
  }

  /** Session, delivery and folder defaults for the selected machine. */
  private applyMachineDefaults(): void {
    const s = this.plugin.settings;
    const m = this.machine;
    if (m) {
      this.session = this.sessionAllowed(m.sessionMode) ? m.sessionMode : "terminal";
      this.delivery = m.delivery;
      this.cwd = m.cwd;
      if (m.agentId && s.agentProfiles.some((a) => a.id === m.agentId)) this.agentId = m.agentId;
    } else {
      const pref = s.agentLocal.sessionMode || (this.avail.herdr ? "herdr" : "terminal");
      this.session = this.sessionAllowed(pref) ? pref : "terminal";
      this.delivery = "inline";
      this.cwd = cardCwd(this.app, this.file) || s.agentLocal.cwd;
    }
  }

  private sessionReason(mode: SessionMode): string | null {
    const m = this.machine;
    if (mode === "herdr") {
      if (m) return m.herdrLabel ? null : "not a herdr machine";
      return this.avail.herdr ? null : "herdr not found";
    }
    if (mode === "tmux" && !m) return this.avail.tmux ? null : (this.avail.tmuxReason ?? "tmux not found");
    return null;
  }

  private sessionAllowed(mode: SessionMode): boolean { return this.sessionReason(mode) === null; }

  private deliveryAllowed(d: CardDelivery): boolean {
    const m = this.machine;
    if (!m) return d === "inline";
    return d !== "shared" || (!!m.sharedLocal && !!m.sharedRemote);
  }

  private renderForm(): void {
    const el = this.contentEl;
    el.empty();
    if (this.outside) {
      el.createDiv({
        cls: "cockpit-launch-warning",
        text: "This card was imported from outside (calendar or email). Its text was not written by you: read the prompt before starting.",
      });
    }
    this.formEl = el.createDiv();
    this.renderFields();

    new Setting(el).setName("Prompt").setDesc("Edit freely. Changing the options above rebuilds it unless you edited it.")
      .addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip("Rebuild the prompt").onClick(() => {
        this.promptEdited = false;
        void this.refreshPrompt();
      }));
    this.promptEl = el.createEl("textarea", { cls: "cockpit-launch-prompt" });
    this.promptEl.rows = 12;
    this.promptEl.value = this.prompt;
    this.promptEl.addEventListener("input", () => {
      this.prompt = this.promptEl?.value ?? "";
      this.promptEdited = true;
    });

    const buttons = el.createDiv({ cls: "cockpit-launch-buttons" });
    buttons.createEl("button", { text: "Copy prompt" }).addEventListener("click", () => {
      void copyText(this.prompt, "Prompt copied");
      this.close();
    });
    const start = buttons.createEl("button", { text: "Start", cls: "mod-cta" });
    start.addEventListener("click", () => { void this.start(start); });
  }

  private renderFields(): void {
    const el = this.formEl;
    if (!el) return;
    el.empty();
    const s = this.plugin.settings;

    new Setting(el).setName("Agent").addDropdown((d) => {
      for (const a of s.agentProfiles) d.addOption(a.id, a.name || a.command);
      d.setValue(this.agent.id).onChange((v) => { this.agentId = v; void this.refreshPrompt(); });
    });

    new Setting(el).setName("Where")
      .addDropdown((d) => {
        d.addOption(LOCAL, "This computer");
        for (const m of this.machines) d.addOption(m.name, m.herdrLabel ? `${m.name} (herdr)` : m.name);
        d.setValue(this.machineName).onChange((v) => {
          this.machineName = v;
          this.applyMachineDefaults();
          this.renderFields();
          void this.refreshPrompt();
        });
      })
      .addExtraButton((b) => b.setIcon("refresh-cw").setTooltip("Look for machines again").onClick(() => {
        this.close();
        new LaunchDialog(this.plugin, this.file, this.outside).open();
      }));

    if (this.machine) {
      new Setting(el).setName("Card file").setDesc("How the agent on that machine gets the card.")
        .addDropdown((d) => {
          for (const k of Object.keys(DELIVERY_NAMES) as CardDelivery[]) {
            d.addOption(k, k === "shared" && !this.deliveryAllowed(k) ? `${DELIVERY_NAMES[k]} (set one in settings)` : DELIVERY_NAMES[k]);
          }
          disableOptions(d.selectEl, (k) => !this.deliveryAllowed(k as CardDelivery));
          d.setValue(this.delivery).onChange((v) => { this.delivery = v as CardDelivery; void this.refreshPrompt(); });
        });
    }

    new Setting(el).setName("Session").addDropdown((d) => {
      for (const k of Object.keys(SESSION_NAMES) as SessionMode[]) {
        const why = this.sessionReason(k);
        d.addOption(k, why ? `${SESSION_NAMES[k]} (${why})` : SESSION_NAMES[k]);
      }
      disableOptions(d.selectEl, (k) => !this.sessionAllowed(k as SessionMode));
      d.setValue(this.session).onChange((v) => { this.session = v as SessionMode; });
    });

    new Setting(el).setName("Folder").setDesc(this.machine ? "On that machine. Empty = home." : "Empty = vault folder.")
      .addText((t) => t.setPlaceholder(this.machine ? "~/Projects/acme" : "~/Projects/acme").setValue(this.cwd)
        .onChange((v) => { this.cwd = v.trim(); }));
  }

  private async refreshPrompt(): Promise<void> {
    if (this.promptEdited) return;
    const seq = ++this.renderSeq;
    const cardFile = remoteCardFile(this.delivery, this.machine, cardIdOf(this.app, this.file));
    const text = await renderPrompt(this.app, this.plugin.settings, this.file, this.agent, cardFile);
    if (seq !== this.renderSeq || this.promptEdited) return;
    this.prompt = text;
    if (this.promptEl) this.promptEl.value = text;
  }

  private async start(button: HTMLButtonElement): Promise<void> {
    if (!this.prompt.trim()) {
      new Notice("The prompt is empty.");
      return;
    }
    button.disabled = true;
    try {
      const remember: Remembered = {
        agentId: this.agent.id, machine: this.machineName, session: this.session, delivery: this.delivery,
      };
      this.app.saveLocalStorage(this.storageKey, remember);
    } catch { /* storage unavailable */ }
    const plan: LaunchPlan = {
      file: this.file,
      agent: this.agent,
      machine: this.machine,
      session: this.session,
      delivery: this.machine ? this.delivery : "inline",
      cwd: this.cwd,
      prompt: this.prompt,
    };
    this.close();
    await runLaunch(this.plugin, plan);
  }
}

function disableOptions(select: HTMLSelectElement, isDisabled: (value: string) => boolean): void {
  for (const opt of Array.from(select.options)) opt.disabled = isDisabled(opt.value);
}

/** Launch with progress and error notices. */
export async function runLaunch(plugin: CockpitBoardPlugin, plan: LaunchPlan): Promise<void> {
  const where = plan.machine?.name ?? "this computer";
  const progress = new Notice(`Starting ${plan.agent.name} on ${where}...`, 0);
  try {
    const summary = await launchAgent(plugin.app, plugin.settings, plan);
    progress.setMessage(`Started: ${summary}`);
    window.setTimeout(() => progress.hide(), 5000);
  } catch (e: unknown) {
    progress.hide();
    const msg = e instanceof Error ? e.message : String(e);
    const runDir = e instanceof LaunchError ? e.runDir : undefined;
    new Notice(`Could not start the agent: ${msg}${runDir ? `\nRun files: ${runDir}` : ""}`, 15000);
  }
}
