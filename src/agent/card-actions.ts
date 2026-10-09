import { App, FuzzySuggestModal, Menu, Notice, TFile } from "obsidian";
import type CockpitBoardPlugin from "../CockpitBoardPlugin";
import { isInFolder } from "../vault-helpers";
import { REF_FORMAT_NAMES, availableFormats, formatReference, type RefFormat } from "./context";
import { cardIdOf } from "./card-id";

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

  /** Copy and agent items for one card; used where a card has no other menu. */
  addCardItems(menu: Menu, file: TFile): void {
    this.addCopyItems(menu, file);
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
