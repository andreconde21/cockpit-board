import { App, Modal, Notice } from "obsidian";
import type { CardData } from "../types";
import { todayStr } from "./dom-helpers";

export class DateTimePickerModal extends Modal {
  private card: CardData;
  private onSave: (file: unknown, props: Record<string, unknown>) => Promise<void>;
  private onDone: () => void;

  constructor(app: App, card: CardData, onSave: (file: unknown, props: Record<string, unknown>) => Promise<void>, onDone: () => void) {
    super(app);
    this.card = card;
    this.onSave = onSave;
    this.onDone = onDone;
  }

  onOpen(): void {
    this.titleEl.setText("Set date & time");

    const dateInput = this.contentEl.createEl("input", { type: "date", cls: "cockpit-dt-input" });
    dateInput.value = this.card.due || todayStr();

    const timeInput = this.contentEl.createEl("input", { type: "time", cls: "cockpit-dt-input cockpit-dt-time-input" });
    timeInput.value = this.card.time || "";

    this.contentEl.createEl("p", { text: "End date (for multi-day tasks):", cls: "cockpit-dt-label" });
    const endDateInput = this.contentEl.createEl("input", { type: "date", cls: "cockpit-dt-input" });
    endDateInput.value = this.card.dueEnd || "";

    const saveBtn = this.contentEl.createEl("button", { text: "Save", cls: "mod-cta cockpit-dt-save-btn" });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        const updates: Record<string, unknown> = {
          due: dateInput.value || "",
          time: timeInput.value || "",
          due_end: endDateInput.value || "",
        };
        if (updates.due) updates.status = "scheduled";
        await this.onSave(this.card.file, updates);
        new Notice(`Date set: ${String(updates.due)}${updates.time ? " " + String(updates.time) : ""}`);
        this.close();
        this.onDone();
      })();
    });

    dateInput.focus();
  }
}

export class BulkDateTimePickerModal extends Modal {
  private count: number;
  private onApply: (updates: Record<string, unknown>) => Promise<void>;

  constructor(app: App, count: number, onApply: (updates: Record<string, unknown>) => Promise<void>) {
    super(app);
    this.count = count;
    this.onApply = onApply;
  }

  onOpen(): void {
    this.titleEl.setText(`Set date & time for ${this.count} card(s)`);

    const dateInput = this.contentEl.createEl("input", { type: "date", cls: "cockpit-dt-input" });
    dateInput.value = todayStr();

    const timeInput = this.contentEl.createEl("input", { type: "time", cls: "cockpit-dt-input cockpit-dt-time-input" });

    this.contentEl.createEl("p", { text: "End date (optional):", cls: "cockpit-dt-label" });
    const endDateInput = this.contentEl.createEl("input", { type: "date", cls: "cockpit-dt-input" });

    const saveBtn = this.contentEl.createEl("button", { text: "Apply to all", cls: "mod-cta cockpit-dt-save-btn" });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        const updates: Record<string, unknown> = {
          due: dateInput.value || "",
          time: timeInput.value || "",
          due_end: endDateInput.value || "",
        };
        if (updates.due) updates.status = "scheduled";
        await this.onApply(updates);
        this.close();
      })();
    });

    dateInput.focus();
  }
}
