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
    // ── General Settings ──
    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("Folder to scan for task files. Leave empty to see the setup prompt.")
      .addText(t => t.setValue(this.plugin.settings.folder).onChange(v => {
        this.plugin.settings.folder = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Archive folder")
      .setDesc("Folder with archived tasks (yyyy/mm/dd structure). Leave empty to hide archive.")
      .addText(t => t.setValue(this.plugin.settings.archiveFolder).onChange(v => {
        this.plugin.settings.archiveFolder = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Recurring config path")
      .setDesc("Path to recurring.json file. Leave empty to disable recurring tasks.")
      .addText(t => t.setValue(this.plugin.settings.recurringConfigPath).onChange(v => {
        this.plugin.settings.recurringConfigPath = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Enable custom card order")
      .setDesc("Allow drag-and-drop reordering within columns. Persists order in frontmatter.")
      .addToggle(t => t.setValue(this.plugin.settings.enableCustomOrder).onChange(v => {
        this.plugin.settings.enableCustomOrder = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Card open mode")
      .setDesc("How cards open when clicked")
      .addDropdown(d => d
        .addOption("split", "Split pane (board + card side by side)")
        .addOption("sidebar", "Right sidebar (board keeps full width)")
        .addOption("modal", "Modal overlay (board stays underneath)")
        .setValue(this.plugin.settings.cardOpenMode || "split")
        .onChange(v => {
          this.plugin.settings.cardOpenMode = v as "split" | "sidebar" | "modal";
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Mobile default column")
      .setDesc("Which column opens first on mobile")
      .addDropdown(d => {
        for (const col of this.plugin.settings.columns) d.addOption(col.id, col.label);
        d.setValue(this.plugin.settings.mobileDefaultColumn || "in-progress")
          .onChange(v => {
            this.plugin.settings.mobileDefaultColumn = v;
            void this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Privacy mode")
      .setDesc("Blur card titles. Hover to reveal. For screen sharing.")
      .addToggle(t => t.setValue(this.plugin.settings.privacyMode).onChange(v => {
        this.plugin.settings.privacyMode = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Checklist editor")
      .setDesc("Click \u2611 on cards to open a drag-and-drop checklist editor")
      .addToggle(t => t.setValue(this.plugin.settings.checklistEditor).onChange(v => {
        this.plugin.settings.checklistEditor = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Card label tint")
      .setDesc("Subtle background tint on cards matching their primary label color")
      .addToggle(t => t.setValue(this.plugin.settings.cardLabelTint).onChange(v => {
        this.plugin.settings.cardLabelTint = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Adjust date on column move")
      .setDesc("When moving a card to soon or scheduled, automatically update the due date to match the column.")
      .addToggle(t => t.setValue(this.plugin.settings.adjustDateOnMove).onChange(v => {
        this.plugin.settings.adjustDateOnMove = v;
        void this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Set today's date on move")
      .setDesc("When moving a card to today, always set the due date to today (even if one is already set).")
      .addToggle(t => t.setValue(this.plugin.settings.setTodayOnMove).onChange(v => {
        this.plugin.settings.setTodayOnMove = v;
        void this.plugin.saveSettings();
      }));

    // ── Pomodoro ──
    new Setting(containerEl).setName("Pomodoro").setHeading();

    new Setting(containerEl)
      .setName("Enable pomodoro timer")
      .setDesc("Adds pomodoro start/stop to card menus and a countdown in the status bar.")
      .addToggle(t => t.setValue(this.plugin.settings.pomodoroEnabled).onChange(v => {
        this.plugin.settings.pomodoroEnabled = v;
        void this.plugin.saveSettings();
        this.plugin.ensureStatusBar();
        this.display();
      }));

    if (this.plugin.settings.pomodoroEnabled) {
      new Setting(containerEl)
        .setName("Work duration (minutes)")
        .addText(t => t.setValue(String(this.plugin.settings.pomodoroWork)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.pomodoroWork = n;
            void this.plugin.saveSettings();
            this.plugin.pomodoro.updateSettings(this.plugin.settings);
          }
        }));

      new Setting(containerEl)
        .setName("Short break (minutes)")
        .addText(t => t.setValue(String(this.plugin.settings.pomodoroShortBreak)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.pomodoroShortBreak = n;
            void this.plugin.saveSettings();
            this.plugin.pomodoro.updateSettings(this.plugin.settings);
          }
        }));

      new Setting(containerEl)
        .setName("Long break (minutes)")
        .addText(t => t.setValue(String(this.plugin.settings.pomodoroLongBreak)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.pomodoroLongBreak = n;
            void this.plugin.saveSettings();
            this.plugin.pomodoro.updateSettings(this.plugin.settings);
          }
        }));

      new Setting(containerEl)
        .setName("Long break after (sessions)")
        .setDesc("Number of work sessions before a long break.")
        .addText(t => t.setValue(String(this.plugin.settings.pomodoroLongBreakInterval)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.pomodoroLongBreakInterval = n;
            void this.plugin.saveSettings();
            this.plugin.pomodoro.updateSettings(this.plugin.settings);
          }
        }));
    }

    // ── Columns ──
    new Setting(containerEl).setName("Columns").setHeading();
    new Setting(containerEl)
      .setDesc("Columns with rules auto-sort cards. Columns without rules are manual (drag-only).");

    const listEl = containerEl.createDiv({ cls: "cockpit-settings-columns" });
    this.renderColumnList(listEl);

    new Setting(containerEl).addButton(btn => btn.setButtonText("+ add column").setCta()
      .onClick(() => { void (async () => {
        this.plugin.settings.columns.push({ id: `custom-${Date.now()}`, label: "New Column", color: "#778CA3", rule: null });
        await this.plugin.saveSettings();
        this.renderColumnList(listEl);
      })(); }));

    new Setting(containerEl).addButton(btn => btn.setButtonText("Reset to defaults").setWarning()
      .onClick(() => { void (async () => {
        this.plugin.settings.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS)) as typeof DEFAULT_COLUMNS;
        await this.plugin.saveSettings();
        this.renderColumnList(listEl);
      })(); }));

    // ── Label colors ──
    new Setting(containerEl).setName("Label colors").setHeading();
    new Setting(containerEl)
      .setDesc("Assign custom colors to labels. Labels without a custom color get auto-assigned from a palette.");

    const labelsEl = containerEl.createDiv({ cls: "cockpit-settings-labels" });
    this.renderLabelColorList(labelsEl);

    new Setting(containerEl).addButton(btn => btn.setButtonText("+ add label color").setCta()
      .onClick(() => { void (async () => {
        const name = "New Label";
        if (!this.plugin.settings.labelColors[name]) {
          this.plugin.settings.labelColors[name] = "#778CA3";
          await this.plugin.saveSettings();
          this.renderLabelColorList(labelsEl);
        }
      })(); }));

    // ── Recurring tasks ──
    if (this.plugin.settings.recurringConfigPath) {
      new Setting(containerEl).setName("Recurring tasks").setHeading();
      new Setting(containerEl)
        .setDesc(`Managed via ${this.plugin.settings.recurringConfigPath}. Edit the file directly or use these buttons.`);

      new Setting(containerEl).addButton(btn => btn.setButtonText("Run recurring check now").onClick(() => {
        void this.plugin.checkRecurring();
      }));

      new Setting(containerEl).addButton(btn => btn.setButtonText("Open recurring config").onClick(() => {
        const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.recurringConfigPath);
        if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
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
        upBtn.addEventListener("click", () => { void (async () => {
          [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
          await this.plugin.saveSettings();
          this.renderColumnList(containerEl);
        })(); });
      }
      if (idx < cols.length - 1) {
        const downBtn = moveEl.createEl("button", { text: "\u2193", cls: "clickable-icon" });
        downBtn.addEventListener("click", () => { void (async () => {
          [cols[idx], cols[idx + 1]] = [cols[idx + 1], cols[idx]];
          await this.plugin.saveSettings();
          this.renderColumnList(containerEl);
        })(); });
      }

      const colorInput = row.createEl("input", { type: "color", cls: "cockpit-settings-color" });
      colorInput.value = col.color || "#778CA3";
      colorInput.addEventListener("change", () => { col.color = colorInput.value; void this.plugin.saveSettings(); });

      const nameInput = row.createEl("input", { type: "text", cls: "cockpit-settings-name", placeholder: "Column name" });
      nameInput.value = col.label;
      nameInput.addEventListener("change", () => { col.label = nameInput.value; void this.plugin.saveSettings(); });

      const ruleInput = row.createEl("input", { type: "text", cls: "cockpit-settings-rule", placeholder: "Rule (empty = manual)" });
      ruleInput.value = col.rule || "";
      ruleInput.addEventListener("change", () => { col.rule = ruleInput.value || null; void this.plugin.saveSettings(); });

      const delBtn = row.createEl("button", { text: "\u2715", cls: "clickable-icon cockpit-settings-delete" });
      delBtn.addEventListener("click", () => { void (async () => {
        cols.splice(idx, 1);
        await this.plugin.saveSettings();
        this.renderColumnList(containerEl);
      })(); });
    }
  }

  private renderLabelColorList(containerEl: HTMLElement): void {
    containerEl.empty();
    const colors = this.plugin.settings.labelColors;

    for (const [label, color] of Object.entries(colors)) {
      const row = containerEl.createDiv({ cls: "cockpit-settings-column-row" });

      const colorInput = row.createEl("input", { type: "color", cls: "cockpit-settings-color" });
      colorInput.value = color;
      colorInput.addEventListener("change", () => {
        this.plugin.settings.labelColors[label] = colorInput.value;
        void this.plugin.saveSettings();
      });

      const nameInput = row.createEl("input", { type: "text", cls: "cockpit-settings-name", placeholder: "Label name" });
      nameInput.value = label;
      nameInput.addEventListener("change", () => { void (async () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== label) {
          this.plugin.settings.labelColors[newName] = this.plugin.settings.labelColors[label];
          delete this.plugin.settings.labelColors[label];
          await this.plugin.saveSettings();
          this.renderLabelColorList(containerEl);
        }
      })(); });

      const delBtn = row.createEl("button", { text: "\u2715", cls: "clickable-icon cockpit-settings-delete" });
      delBtn.addEventListener("click", () => { void (async () => {
        delete this.plugin.settings.labelColors[label];
        await this.plugin.saveSettings();
        this.renderLabelColorList(containerEl);
      })(); });
    }
  }
}
