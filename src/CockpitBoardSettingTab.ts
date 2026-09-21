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
      .setName("Clear date on in progress")
      .setDesc("When moving a card to in progress, clear the due date if no time is set.")
      .addToggle(t => t.setValue(this.plugin.settings.clearDateOnInProgress).onChange(v => {
        this.plugin.settings.clearDateOnInProgress = v;
        void this.plugin.saveSettings();
      }));

    // ── Notifications ──
    new Setting(containerEl).setName("Notifications").setHeading();

    new Setting(containerEl)
      .setName("Reminder lead times")
      .setDesc("Minutes before a card's time to warn, comma separated (e.g. \"15,1\"). Each lead fires once per card per day. Checked every 30 seconds.")
      .addText(t => t
        .setPlaceholder("15,1")
        .setValue(this.plugin.settings.notifyLeadMinutes)
        .onChange(v => {
          this.plugin.settings.notifyLeadMinutes = v;
          void this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Desktop notifications")
      .setDesc("Also send a system notification, so reminders arrive when Obsidian is in the background.")
      .addToggle(t => t.setValue(this.plugin.settings.notifySystem).onChange(v => {
        this.plugin.settings.notifySystem = v;
        void this.plugin.saveSettings();
      }));

    // ── Auto-archive ──
    new Setting(containerEl).setName("Auto-archive").setHeading();

    new Setting(containerEl)
      .setName("Auto-archive done cards")
      .setDesc("Automatically move done cards into the archive folder (yyyy/mm/dd structure, based on the completed date). Requires both a tasks folder and an archive folder. Checked hourly.")
      .addToggle(t => t.setValue(this.plugin.settings.autoArchiveEnabled).onChange(v => {
        this.plugin.settings.autoArchiveEnabled = v;
        void this.plugin.saveSettings();
        this.display();
      }));

    if (this.plugin.settings.autoArchiveEnabled) {
      new Setting(containerEl)
        .setName("Days to keep done cards")
        .setDesc("Archive done cards this many days after completion. 0 archives them right away.")
        .addText(t => t.setValue(String(this.plugin.settings.autoArchiveAfterDays)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.autoArchiveAfterDays = n;
            void this.plugin.saveSettings();
          }
        }));

      new Setting(containerEl).addButton(btn => btn.setButtonText("Archive done cards now").onClick(() => {
        void this.plugin.runAutoArchive(true);
      }));
    }

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

    new Setting(containerEl).addButton(btn => btn.setButtonText("Reset to defaults").setDestructive()
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

    // ── External calendars (Outlook / ICS) ──
    new Setting(containerEl).setName("External calendars").setHeading();
    new Setting(containerEl)
      .setDesc("One-way editable import: new events become cards in your tasks folder with the label you choose. Imported cards are never overwritten, so your edits are safe. Skipped automatically: cancelled events, subjects starting with “Canceled:”/“Cancelled:”, and blocks with no title.");

    new Setting(containerEl)
      .setName("How to get the Outlook link")
      .setDesc("Outlook on the web: Calendar > Share > Publish > copy the ICS link. Outlook desktop: Calendar > Publish Online > copy the link. Or export a .ics file into your vault and put its path below instead of a URL.");

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often enabled calendars import new events. Minimum 5. Also syncs hourly and on startup.")
      .addText(t => t.setValue(String(this.plugin.settings.externalSyncIntervalMinutes || 60)).onChange(v => {
        const n = parseInt(v);
        if (!isNaN(n) && n >= 5) {
          this.plugin.settings.externalSyncIntervalMinutes = n;
          void this.plugin.saveSettings();
        }
      }));

    const extEl = containerEl.createDiv({ cls: "cockpit-settings-external" });
    this.renderExternalCalendarList(extEl);

    new Setting(containerEl).addButton(btn => btn.setButtonText("+ add calendar").setCta()
      .onClick(() => { void (async () => {
        this.plugin.settings.externalCalendars.push({
          id: `ext-${Date.now()}`,
          name: "Client calendar",
          url: "",
          filePath: "",
          label: "",
          project: "",
          timeZone: "",
          onDisappear: "keep",
          enabled: true,
          daysBack: 7,
          daysAhead: 60,
        });
        await this.plugin.saveSettings();
        this.renderExternalCalendarList(extEl);
      })(); }));

    new Setting(containerEl).addButton(btn => btn.setButtonText("Sync external calendars now").onClick(() => {
      void this.plugin.syncExternalCalendars(true);
    }));

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

  private renderExternalCalendarList(containerEl: HTMLElement): void {
    containerEl.empty();
    const sources = this.plugin.settings.externalCalendars || [];
    if (sources.length === 0) {
      containerEl.createEl("p", {
        text: "No external calendars yet. Add one for your client Outlook calendar, set its label, then sync.",
        cls: "setting-item-description",
      });
      return;
    }

    sources.forEach((src, idx) => {
      const card = containerEl.createDiv({ cls: "cockpit-settings-external-card" });

      const head = card.createDiv({ cls: "cockpit-settings-column-row" });
      const enabledInput = head.createEl("input", { type: "checkbox" });
      enabledInput.checked = src.enabled !== false;
      enabledInput.title = "Enabled";
      enabledInput.addEventListener("change", () => {
        src.enabled = enabledInput.checked;
        void this.plugin.saveSettings();
      });
      const nameInput = head.createEl("input", {
        type: "text", cls: "cockpit-settings-name", placeholder: "Calendar name (e.g. Client Acme)",
      });
      nameInput.value = src.name || "";
      nameInput.addEventListener("change", () => { src.name = nameInput.value; void this.plugin.saveSettings(); });
      const delBtn = head.createEl("button", { text: "\u2715", cls: "clickable-icon cockpit-settings-delete" });
      delBtn.title = "Remove calendar";
      delBtn.addEventListener("click", () => { void (async () => {
        sources.splice(idx, 1);
        await this.plugin.saveSettings();
        this.renderExternalCalendarList(containerEl);
      })(); });

      const urlRow = new Setting(card)
        .setName("ICS URL")
        .setDesc("Published Outlook ICS link (https:// or webcal://). Leave empty to use a vault file instead.");
      urlRow.addText(t => t.setPlaceholder("https://outlook.office365.com/owa/calendar/…/calendar.ics")
        .setValue(src.url || "").onChange(v => { src.url = v; void this.plugin.saveSettings(); }));

      const fileRow = new Setting(card)
        .setName("ICS file")
        .setDesc("Vault path (e.g. Calendars/client.ics) or, on desktop, an absolute path like ~/Downloads/client.ics.");
      fileRow.addText(t => t.setPlaceholder("Calendars/client.ics")
        .setValue(src.filePath || "").onChange(v => { src.filePath = v; void this.plugin.saveSettings(); }));

      const labelRow = new Setting(card)
        .setName("Label")
        .setDesc("Applied to every imported card. Cards stay in your tasks folder — filter by this label.");
      labelRow.addText(t => t.setPlaceholder("ClientAcme")
        .setValue(src.label || "").onChange(v => { src.label = v; void this.plugin.saveSettings(); }));

      const projectRow = new Setting(card)
        .setName("Project")
        .setDesc("Set on every imported card. Shown as a [Project] prefix. Leave empty for none.");
      projectRow.addText(t => t.setPlaceholder("ClientAcme")
        .setValue(src.project || "").onChange(v => { src.project = v; void this.plugin.saveSettings(); }));

      const tzRow = new Setting(card)
        .setName("Source timezone")
        .setDesc("IANA zone the calendar lives in (e.g. Europe/Zurich). Times convert to your device time. Leave empty when the calendar is already in your time.");
      tzRow.addText(t => t.setPlaceholder("Europe/Zurich")
        .setValue(src.timeZone || "").onChange(v => { src.timeZone = v; void this.plugin.saveSettings(); }));

      const goneRow = new Setting(card)
        .setName("When events disappear")
        .setDesc("An event deleted in Outlook leaves no trace. Keep the card, mark it done, or delete it. Only applies inside the sync window.");
      goneRow.addDropdown(d => d
        .addOption("keep", "Keep the card")
        .addOption("done", "Mark done")
        .addOption("delete", "Delete the card")
        .setValue(src.onDisappear || "keep")
        .onChange(v => {
          src.onDisappear = v as "keep" | "done" | "delete";
          void this.plugin.saveSettings();
        }));

      const windowRow = new Setting(card).setName("Sync window").setDesc("Days back / ahead to import.");
      windowRow.addText(t => {
        t.inputEl.type = "number";
        t.inputEl.addClass("cockpit-settings-number");
        t.setValue(String(src.daysBack ?? 7)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n >= 0 && n <= 365) { src.daysBack = n; void this.plugin.saveSettings(); }
        });
      });
      windowRow.addText(t => {
        t.inputEl.type = "number";
        t.inputEl.addClass("cockpit-settings-number");
        t.setValue(String(src.daysAhead ?? 60)).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n >= 1 && n <= 730) { src.daysAhead = n; void this.plugin.saveSettings(); }
        });
      });

      if (src.lastSync) {
        card.createEl("p", {
          text: `Last sync: ${src.lastSync}`,
          cls: "setting-item-description",
        });
      }
    });
  }
}
