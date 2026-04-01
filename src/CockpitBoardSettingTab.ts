import { App, PluginSettingTab, Setting, TFile, Notice } from "obsidian";
import { DEFAULT_COLUMNS } from "./constants";
import type CockpitBoardPlugin from "./CockpitBoardPlugin";

export class CockpitBoardSettingTab extends PluginSettingTab {
  plugin: CockpitBoardPlugin;

  constructor(app: App, plugin: CockpitBoardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cockpit Board" });

    // ── General Settings ──
    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("Folder to scan for task files. Leave empty to see the setup prompt.")
      .addText(t => t.setValue(this.plugin.settings.folder).onChange(async v => {
        this.plugin.settings.folder = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Folder with archived tasks (YYYY/MM/DD structure). Leave empty to hide archive.")
      .addText(t => t.setValue(this.plugin.settings.archiveFolder).onChange(async v => {
        this.plugin.settings.archiveFolder = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Recurring config path")
      .setDesc("Path to recurring.json file. Leave empty to disable recurring tasks.")
      .addText(t => t.setValue(this.plugin.settings.recurringConfigPath).onChange(async v => {
        this.plugin.settings.recurringConfigPath = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Enable custom card order")
      .setDesc("Allow drag-and-drop reordering within columns. Persists order in frontmatter.")
      .addToggle(t => t.setValue(this.plugin.settings.enableCustomOrder).onChange(async v => {
        this.plugin.settings.enableCustomOrder = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Card open mode")
      .setDesc("How cards open when clicked")
      .addDropdown(d => d
        .addOption("split", "Split pane (board + card side by side)")
        .addOption("sidebar", "Right sidebar (board keeps full width)")
        .addOption("modal", "Modal overlay (board stays underneath)")
        .setValue(this.plugin.settings.cardOpenMode || "split")
        .onChange(async v => {
          this.plugin.settings.cardOpenMode = v as "split" | "sidebar" | "modal";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Mobile default column")
      .setDesc("Which column opens first on mobile")
      .addDropdown(d => {
        for (const col of this.plugin.settings.columns) d.addOption(col.id, col.label);
        d.setValue(this.plugin.settings.mobileDefaultColumn || "in-progress")
          .onChange(async v => {
            this.plugin.settings.mobileDefaultColumn = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Privacy mode")
      .setDesc("Blur card titles. Hover to reveal. For screen sharing.")
      .addToggle(t => t.setValue(this.plugin.settings.privacyMode).onChange(async v => {
        this.plugin.settings.privacyMode = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Checklist editor")
      .setDesc("Click \u2611 on cards to open a drag-and-drop checklist editor")
      .addToggle(t => t.setValue(this.plugin.settings.checklistEditor).onChange(async v => {
        this.plugin.settings.checklistEditor = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Card label tint")
      .setDesc("Subtle background tint on cards matching their primary label color")
      .addToggle(t => t.setValue(this.plugin.settings.cardLabelTint).onChange(async v => {
        this.plugin.settings.cardLabelTint = v;
        await this.plugin.saveSettings();
      }));

    // ── Columns ──
    containerEl.createEl("h3", { text: "Columns" });
    containerEl.createEl("p", {
      text: "Columns with rules auto-sort cards. Columns without rules are manual (drag-only).",
      cls: "setting-item-description",
    });

    const listEl = containerEl.createDiv({ cls: "cockpit-settings-columns" });
    this.renderColumnList(listEl);

    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add column").setCta()
      .onClick(async () => {
        this.plugin.settings.columns.push({ id: `custom-${Date.now()}`, label: "New Column", color: "#778CA3", rule: null });
        await this.plugin.saveSettings();
        this.renderColumnList(listEl);
      }));

    new Setting(containerEl).addButton(btn => btn.setButtonText("Reset to defaults").setWarning()
      .onClick(async () => {
        this.plugin.settings.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
        await this.plugin.saveSettings();
        this.renderColumnList(listEl);
      }));

    // ── Label Colors ──
    containerEl.createEl("h3", { text: "Label Colors" });
    containerEl.createEl("p", {
      text: "Assign custom colors to labels. Labels without a custom color get auto-assigned from a palette.",
      cls: "setting-item-description",
    });

    const labelsEl = containerEl.createDiv({ cls: "cockpit-settings-labels" });
    this.renderLabelColorList(labelsEl);

    new Setting(containerEl).addButton(btn => btn.setButtonText("+ Add label color").setCta()
      .onClick(async () => {
        const name = "New Label";
        if (!this.plugin.settings.labelColors[name]) {
          this.plugin.settings.labelColors[name] = "#778CA3";
          await this.plugin.saveSettings();
          this.renderLabelColorList(labelsEl);
        }
      }));

    // ── Recurring Tasks ──
    if (this.plugin.settings.recurringConfigPath) {
      containerEl.createEl("h3", { text: "Recurring Tasks" });
      containerEl.createEl("p", {
        text: `Managed via ${this.plugin.settings.recurringConfigPath}. Edit the file directly or use these buttons.`,
        cls: "setting-item-description",
      });

      new Setting(containerEl).addButton(btn => btn.setButtonText("Run recurring check now").onClick(async () => {
        await this.plugin.checkRecurring();
      }));

      new Setting(containerEl).addButton(btn => btn.setButtonText("Open recurring config").onClick(async () => {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.recurringConfigPath);
        if (file) this.app.workspace.getLeaf("tab").openFile(file as TFile);
        else new Notice(`${this.plugin.settings.recurringConfigPath} not found`);
      }));
    }
  }

  private renderColumnList(containerEl: HTMLElement): void {
    containerEl.empty();
    const cols = this.plugin.settings.columns;

    for (let idx = 0; idx < cols.length; idx++) {
      const col = cols[idx];
      const row = containerEl.createDiv({ cls: "cockpit-settings-column-row" });

      const moveEl = row.createDiv({ cls: "cockpit-settings-move" });
      if (idx > 0) {
        const upBtn = moveEl.createEl("button", { text: "\u2191", cls: "clickable-icon" });
        upBtn.addEventListener("click", async () => {
          [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
          await this.plugin.saveSettings();
          this.renderColumnList(containerEl);
        });
      }
      if (idx < cols.length - 1) {
        const downBtn = moveEl.createEl("button", { text: "\u2193", cls: "clickable-icon" });
        downBtn.addEventListener("click", async () => {
          [cols[idx], cols[idx + 1]] = [cols[idx + 1], cols[idx]];
          await this.plugin.saveSettings();
          this.renderColumnList(containerEl);
        });
      }

      const colorInput = row.createEl("input", { type: "color", cls: "cockpit-settings-color" });
      colorInput.value = col.color || "#778CA3";
      colorInput.addEventListener("change", async () => { col.color = colorInput.value; await this.plugin.saveSettings(); });

      const nameInput = row.createEl("input", { type: "text", cls: "cockpit-settings-name", placeholder: "Column name" });
      nameInput.value = col.label;
      nameInput.addEventListener("change", async () => { col.label = nameInput.value; await this.plugin.saveSettings(); });

      const ruleInput = row.createEl("input", { type: "text", cls: "cockpit-settings-rule", placeholder: "Rule (empty = manual)" });
      ruleInput.value = col.rule || "";
      ruleInput.addEventListener("change", async () => { col.rule = ruleInput.value || null; await this.plugin.saveSettings(); });

      const delBtn = row.createEl("button", { text: "\u2715", cls: "clickable-icon cockpit-settings-delete" });
      delBtn.addEventListener("click", async () => {
        cols.splice(idx, 1);
        await this.plugin.saveSettings();
        this.renderColumnList(containerEl);
      });
    }
  }

  private renderLabelColorList(containerEl: HTMLElement): void {
    containerEl.empty();
    const colors = this.plugin.settings.labelColors;

    for (const [label, color] of Object.entries(colors)) {
      const row = containerEl.createDiv({ cls: "cockpit-settings-column-row" });

      const colorInput = row.createEl("input", { type: "color", cls: "cockpit-settings-color" });
      colorInput.value = color;
      colorInput.addEventListener("change", async () => {
        this.plugin.settings.labelColors[label] = colorInput.value;
        await this.plugin.saveSettings();
      });

      const nameInput = row.createEl("input", { type: "text", cls: "cockpit-settings-name", placeholder: "Label name" });
      nameInput.value = label;
      nameInput.addEventListener("change", async () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== label) {
          this.plugin.settings.labelColors[newName] = this.plugin.settings.labelColors[label];
          delete this.plugin.settings.labelColors[label];
          await this.plugin.saveSettings();
          this.renderLabelColorList(containerEl);
        }
      });

      const delBtn = row.createEl("button", { text: "\u2715", cls: "clickable-icon cockpit-settings-delete" });
      delBtn.addEventListener("click", async () => {
        delete this.plugin.settings.labelColors[label];
        await this.plugin.saveSettings();
        this.renderLabelColorList(containerEl);
      });
    }
  }
}
