import { App, Modal } from "obsidian";
import type { CardData } from "../types";

interface ChecklistItem {
  checked: boolean;
  text: string;
}

interface Checklist {
  name: string;
  items: ChecklistItem[];
}

export class ChecklistEditorModal extends Modal {
  private card: CardData;
  private checklists: Checklist[] = [];
  private lines: string[] = [];
  private onSave: () => void;

  constructor(app: App, card: CardData, onSave: () => void) {
    super(app);
    this.card = card;
    this.onSave = onSave;
  }

  async onOpen(): Promise<void> {
    const content = await this.app.vault.read(this.card.file);
    this.titleEl.setText(`Checklists: ${this.card.displayTitle}`);
    this.modalEl.addClass("cockpit-checklist-modal");

    this.lines = content.split("\n");
    this.checklists = this.parseChecklists(this.lines);

    this.renderContent();
  }

  private parseChecklists(lines: string[]): Checklist[] {
    const checklists: Checklist[] = [];
    let current: Checklist | null = null;
    for (const line of lines) {
      const headingMatch = line.match(/^## Checklist:?\s*(.*)/);
      if (headingMatch) {
        current = { name: headingMatch[1].trim() || "Checklist", items: [] };
        checklists.push(current);
        continue;
      }
      const itemMatch = line.match(/^- \[([ x])\] (.+)$/i);
      if (itemMatch && current) {
        current.items.push({ checked: itemMatch[1].toLowerCase() === "x", text: itemMatch[2] });
      }
    }
    if (checklists.length === 0) {
      current = { name: "Checklist", items: [] };
      for (const line of lines) {
        const m = line.match(/^- \[([ x])\] (.+)$/i);
        if (m) current.items.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
      }
      if (current.items.length > 0) checklists.push(current);
    }
    return checklists;
  }

  private renderContent(): void {
    const { contentEl } = this;
    contentEl.empty();

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const autoSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.saveChecklists(), 500);
    };

    // Global sort button
    const globalSortBtn = contentEl.createEl("button", { text: "\u2713 Done first", cls: "cockpit-cl-sort-btn cockpit-cl-global-sort" });
    globalSortBtn.addEventListener("click", async () => {
      for (const cl of this.checklists) {
        cl.items.sort((a, b) => (b.checked ? 1 : 0) - (a.checked ? 1 : 0));
      }
      await this.saveChecklists();
      this.onSave();
      this.close();
    });

    for (const cl of this.checklists) {
      const section = contentEl.createDiv({ cls: "cockpit-cl-section" });
      section.createEl("h3", { text: cl.name, cls: "cockpit-cl-heading" });
      const listEl = section.createDiv({ cls: "cockpit-cl-list" });
      this.renderChecklist(cl, listEl, autoSave);

      const addRow = section.createDiv({ cls: "cockpit-cl-add-row" });
      const addInput = addRow.createEl("input", { type: "text", placeholder: `New item in ${cl.name}...`, cls: "cockpit-cl-text" });
      const addBtn = addRow.createEl("button", { text: "+ Add", cls: "cockpit-cl-add-btn" });
      const addItem = () => {
        if (!addInput.value.trim()) return;
        cl.items.push({ checked: false, text: addInput.value.trim() });
        addInput.value = "";
        this.renderChecklist(cl, listEl, autoSave);
        autoSave();
      };
      addBtn.addEventListener("click", addItem);
      addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addItem(); });
    }

    // Add new checklist section
    const newClRow = contentEl.createDiv({ cls: "cockpit-cl-add-row" });
    const newClInput = newClRow.createEl("input", { type: "text", placeholder: "New checklist name...", cls: "cockpit-cl-text" });
    const newClBtn = newClRow.createEl("button", { text: "+ Add checklist", cls: "cockpit-cl-add-btn" });
    newClBtn.addEventListener("click", () => {
      if (!newClInput.value.trim()) return;
      this.checklists.push({ name: newClInput.value.trim(), items: [] });
      newClInput.value = "";
      this.renderContent();
    });
  }

  private renderChecklist(cl: Checklist, containerEl: HTMLElement, autoSave: () => void): void {
    containerEl.empty();
    cl.items.forEach((item, idx) => {
      const row = containerEl.createDiv({ cls: "cockpit-cl-row" });
      const handle = row.createSpan({ text: "\u22EE\u22EE", cls: "cockpit-cl-handle" });
      handle.draggable = true;
      handle.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(idx));
        row.classList.add("cockpit-cl-dragging");
      });
      handle.addEventListener("dragend", () => row.classList.remove("cockpit-cl-dragging"));
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("cockpit-cl-dragover"); });
      row.addEventListener("dragleave", () => row.classList.remove("cockpit-cl-dragover"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("cockpit-cl-dragover");
        const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "");
        if (isNaN(fromIdx) || fromIdx === idx) return;
        const [moved] = cl.items.splice(fromIdx, 1);
        cl.items.splice(idx, 0, moved);
        this.renderChecklist(cl, containerEl, autoSave);
        autoSave();
      });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = item.checked;
      cb.addEventListener("change", () => { item.checked = cb.checked; autoSave(); });
      const input = row.createEl("input", { type: "text", cls: "cockpit-cl-text", value: item.text });
      input.addEventListener("change", () => { item.text = input.value; autoSave(); });
      const del = row.createEl("button", { text: "\u2715", cls: "cockpit-cl-delete" });
      del.addEventListener("click", () => { cl.items.splice(idx, 1); this.renderChecklist(cl, containerEl, autoSave); autoSave(); });
    });
  }

  private async saveChecklists(): Promise<void> {
    const newLines: string[] = [];
    let inChecklist = false;
    for (const line of this.lines) {
      if (line.match(/^## Checklist/)) { inChecklist = true; continue; }
      if (inChecklist && (line.match(/^- \[[ x]\] /i) || !line.trim())) continue;
      if (inChecklist && line.match(/^## /)) { inChecklist = false; }
      if (inChecklist && line.trim() && !line.match(/^- \[[ x]\] /i)) { inChecklist = false; }
      if (!inChecklist) newLines.push(line);
    }
    for (const cl of this.checklists) {
      if (cl.items.length === 0) continue;
      newLines.push("", `## Checklist: ${cl.name}`);
      for (const item of cl.items) {
        newLines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
      }
    }
    await this.app.vault.modify(this.card.file, newLines.join("\n"));
  }
}
