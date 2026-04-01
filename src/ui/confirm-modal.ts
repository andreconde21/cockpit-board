import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.titleEl.setText("Confirm");
    this.contentEl.createEl("p", { text: this.message });

    const btnRow = this.contentEl.createDiv({ cls: "cockpit-confirm-buttons" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnRow.createEl("button", { text: "Delete", cls: "mod-warning" });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }
}
