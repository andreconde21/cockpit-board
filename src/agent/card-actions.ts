import { App, FuzzySuggestModal, Menu, Notice, Platform, TFile } from "obsidian";
import type CockpitBoardPlugin from "../CockpitBoardPlugin";
import { OUTSIDE_SOURCES } from "../constants";
import type { AgentProfile } from "../types";
import { isInFolder } from "../vault-helpers";
import { REF_FORMAT_NAMES, availableFormats, formatReference, type RefFormat } from "./context";
import { cardIdOf } from "./card-id";
import { LaunchDialog, cardCwd, runLaunch } from "./launch-dialog";
import { localAvailability, renderPrompt } from "./launcher";

/**
 * Card-level actions shared by every place a card can be right-clicked: the
 * board, the calendar, the file menu (tab header, file explorer) and the card
 * modal. One place, so the menus stay the same everywhere.
 */
export class CardActions {
  constructor(private plugin: CockpitBoardPlugin) {}

  private get app(): App { return this.plugin.app; }

  /** True for markdown files in the tasks or archive folder. */
  isCard(file: unknown): file is TFile {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    const s = this.plugin.settings;
    return isInFolder(file.path, s.folder) || (!!s.archiveFolder && isInFolder(file.path, s.archiveFolder));
  }

  async copy(file: TFile, format: RefFormat): Promise<void> {
    await copyText(await formatReference(this.app, file, format), `Copied ${REF_FORMAT_NAMES[format].toLowerCase().replace(/ \(.*$/, "")}`);
  }

  /** Copy items: ID, path, agent context, and a picker with every format. */
  addCopyItems(menu: Menu, file: TFile): void {
    menu.addItem((i) => i.setTitle("Copy card ID").setIcon("hash").onClick(() => { void this.copy(file, "id"); }));
    menu.addItem((i) => i.setTitle("Copy path").setIcon("copy").onClick(() => { void this.copy(file, "path"); }));
    menu.addItem((i) => i.setTitle("Copy as agent context").setIcon("clipboard-list")
      .onClick(() => { void this.copy(file, "context"); }));
    menu.addItem((i) => i.setTitle("Copy reference...").setIcon("link")
      .onClick(() => this.pickReference(file)));
  }

  /** Copy and agent items for one card. */
  addCardItems(menu: Menu, file: TFile): void {
    this.addCopyItems(menu, file);
    this.addAgentItems(menu, file);
  }

  /** Launching needs the desktop app and the opt-in setting. */
  agentsEnabled(): boolean {
    return Platform.isDesktopApp && this.plugin.settings.agentLauncherEnabled;
  }

  defaultAgent(): AgentProfile {
    const s = this.plugin.settings;
    return s.agentProfiles.find((a) => a.id === s.defaultAgentId) ?? s.agentProfiles[0];
  }

  /** Cards whose text came from outside (calendar import, email). */
  isOutside(file: TFile): boolean {
    const source: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.source;
    return typeof source === "string" && OUTSIDE_SOURCES.includes(source.trim().toLowerCase());
  }

  addAgentItems(menu: Menu, file: TFile): void {
    if (!this.agentsEnabled()) return;
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Start agent...").setIcon("bot")
      .onClick(() => this.openLaunchDialog(file)));
    const agent = this.defaultAgent();
    if (agent) {
      // Imported cards always go through the dialog; say so in the menu.
      const title = this.isOutside(file)
        ? `Start ${agent.name || agent.command} (check the prompt first)...`
        : `Start ${agent.name || agent.command}`;
      menu.addItem((i) => i.setTitle(title).setIcon("play")
        .onClick(() => { void this.quickStart(file); }));
    }
  }

  openLaunchDialog(file: TFile): void {
    if (!this.agentsEnabled()) {
      new Notice("Turn on the agent launcher in settings first (desktop only).");
      return;
    }
    new LaunchDialog(this.plugin, file, this.isOutside(file)).open();
  }

  /**
   * The default agent on this computer, no dialog. Cards from outside always
   * get the dialog, so their prompt is seen before anything runs.
   */
  async quickStart(file: TFile): Promise<void> {
    if (!this.agentsEnabled()) {
      new Notice("Turn on the agent launcher in settings first (desktop only).");
      return;
    }
    if (this.isOutside(file)) {
      new Notice("This card was imported (calendar or email): check the prompt, then click start.", 6000);
      this.openLaunchDialog(file);
      return;
    }
    const s = this.plugin.settings;
    const avail = await localAvailability(s);
    const session = s.agentLocal.sessionMode || (avail.herdr ? "herdr" : "terminal");
    if ((session === "herdr" && !avail.herdr) || (session === "tmux" && !avail.tmux)) {
      new Notice(`${session} is not available here; pick another session.`);
      this.openLaunchDialog(file);
      return;
    }
    const agent = this.defaultAgent();
    await runLaunch(this.plugin, {
      file,
      agent,
      machine: null,
      session,
      delivery: "inline",
      cwd: cardCwd(this.app, file) || s.agentLocal.cwd,
      prompt: await renderPrompt(this.app, s, file, agent),
    });
  }

  pickReference(file: TFile): void {
    new ReferencePicker(this.app, (format) => { void this.copy(file, format); }).open();
  }

  /** "Copy IDs" / "Copy paths" for a multi-selection, one per line. */
  async copyMany(files: TFile[], format: "id" | "path"): Promise<void> {
    const lines = files.map((f) => (format === "id" ? cardIdOf(this.app, f) : f.path));
    await copyText(lines.join("\n"), `Copied ${files.length} ${format === "id" ? "IDs" : "paths"}`);
  }
}

export async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(confirmation, 2000);
  } catch (e: unknown) {
    new Notice(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
  }
}

class ReferencePicker extends FuzzySuggestModal<RefFormat> {
  constructor(app: App, private onPick: (format: RefFormat) => void) {
    super(app);
    this.setPlaceholder("Copy this card as...");
  }

  getItems(): RefFormat[] { return availableFormats(); }
  getItemText(item: RefFormat): string { return REF_FORMAT_NAMES[item]; }
  onChooseItem(item: RefFormat): void { this.onPick(item); }
}
