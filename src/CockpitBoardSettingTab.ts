import { App, Notice, PluginSettingTab, Setting, TFile } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import { DEFAULT_COLUMNS } from "./constants";
import type CockpitBoardPlugin from "./CockpitBoardPlugin";
import type { ExternalCalendarSource } from "./types";

/**
 * Settings, declared with Obsidian's settings API (1.13+): every row is a
 * definition, so Obsidian can index it for settings search, and conditional
 * rows use `visible` + `update()` instead of re-running `display()`.
 * Controls are rendered with the familiar Setting builders so saving keeps
 * its side effects (pomodoro, status bar).
 */
export class CockpitBoardSettingTab extends PluginSettingTab {
  plugin: CockpitBoardPlugin;

  constructor(app: App, plugin: CockpitBoardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private save(): void {
    void this.plugin.saveSettings();
  }

  private async saveAndRefresh(): Promise<void> {
    await this.plugin.saveSettings();
    this.update();
  }

  /** A text setting bound to a string field. */
  private textField(
    name: string,
    desc: string,
    get: () => string,
    set: (value: string) => void,
    placeholder?: string,
  ): SettingDefinition {
    return {
      name,
      desc,
      render: (setting: Setting) => {
        setting.addText(t => {
          if (placeholder) t.setPlaceholder(placeholder);
          t.setValue(get()).onChange(v => { set(v); this.save(); });
        });
      },
    };
  }

  /** A text setting holding a whole number, saved only when it is valid. */
  private numberField(
    name: string,
    desc: string,
    get: () => number,
    set: (value: number) => void,
    min: number,
    after?: () => void,
  ): SettingDefinition {
    return {
      name,
      desc,
      render: (setting: Setting) => {
        setting.addText(t => t.setValue(String(get())).onChange(v => {
          const n = parseInt(v);
          if (!isNaN(n) && n >= min) {
            set(n);
            this.save();
            after?.();
          }
        }));
      },
    };
  }

  /** A toggle bound to a boolean field; `refresh` re-evaluates visibility. */
  private toggleField(
    name: string,
    desc: string,
    get: () => boolean,
    set: (value: boolean) => void,
    refresh = false,
    after?: () => void,
  ): SettingDefinition {
    return {
      name,
      desc,
      render: (setting: Setting) => {
        setting.addToggle(t => t.setValue(get()).onChange(v => {
          set(v);
          after?.();
          if (refresh) void this.saveAndRefresh();
          else this.save();
        }));
      },
    };
  }

  /** A button-only row. */
  private button(name: string, label: string, onClick: () => void, cta = false): SettingDefinition {
    return {
      name,
      render: (setting: Setting) => {
        setting.addButton(btn => {
          btn.setButtonText(label).onClick(onClick);
          if (cta) btn.setCta();
        });
      },
    };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    return [
      {
        type: "group",
        items: [
          this.textField("Tasks folder", "Folder to scan for task files. Leave empty to see the setup prompt.",
            () => s.folder, v => { s.folder = v; }),
          this.textField("Archive folder", "Folder with archived tasks (yyyy/mm/dd structure). Leave empty to hide archive.",
            () => s.archiveFolder, v => { s.archiveFolder = v; }),
          this.textField("Recurring config path", "Path to recurring.json file. Leave empty to disable recurring tasks.",
            () => s.recurringConfigPath, v => { s.recurringConfigPath = v; }),
          this.toggleField("Enable custom card order", "Allow drag-and-drop reordering within columns. Persists order in frontmatter.",
            () => s.enableCustomOrder, v => { s.enableCustomOrder = v; }),
          {
            name: "Card open mode",
            desc: "How cards open when clicked",
            render: (setting: Setting) => {
              setting.addDropdown(d => d
                .addOption("split", "Split pane (board + card side by side)")
                .addOption("sidebar", "Right sidebar (board keeps full width)")
                .addOption("modal", "Modal overlay (board stays underneath)")
                .setValue(s.cardOpenMode || "split")
                .onChange(v => { s.cardOpenMode = v as "split" | "sidebar" | "modal"; this.save(); }));
            },
          },
          {
            name: "Mobile default column",
            desc: "Which column opens first on mobile",
            render: (setting: Setting) => {
              setting.addDropdown(d => {
                for (const col of s.columns) d.addOption(col.id, col.label);
                d.setValue(s.mobileDefaultColumn || "in-progress")
                  .onChange(v => { s.mobileDefaultColumn = v; this.save(); });
              });
            },
          },
          this.toggleField("Privacy mode", "Blur card titles. Hover to reveal. For screen sharing.",
            () => s.privacyMode, v => { s.privacyMode = v; }),
          this.toggleField("Checklist editor", "Click ☑ on cards to open a drag-and-drop checklist editor",
            () => s.checklistEditor, v => { s.checklistEditor = v; }),
          this.toggleField("Card label tint", "Subtle background tint on cards matching their primary label color",
            () => s.cardLabelTint, v => { s.cardLabelTint = v; }),
          this.toggleField("Clear date on in progress", "When moving a card to in progress, clear the due date if no time is set.",
            () => s.clearDateOnInProgress, v => { s.clearDateOnInProgress = v; }),
        ],
      },
      {
        type: "group",
        heading: "Notifications",
        items: [
          this.textField("Reminder lead times",
            "Minutes before a card's time to warn, comma separated (e.g. \"15,1\"). Each lead fires once per card per day. Checked every 30 seconds.",
            () => s.notifyLeadMinutes, v => { s.notifyLeadMinutes = v; }, "15,1"),
          this.toggleField("Desktop notifications",
            "Also send a system notification, so reminders arrive when Obsidian is in the background.",
            () => s.notifySystem, v => { s.notifySystem = v; }),
        ],
      },
      {
        type: "group",
        heading: "Auto-archive",
        items: [
          this.toggleField("Auto-archive done cards",
            "Automatically move done cards into the archive folder (yyyy/mm/dd structure, based on the completed date). Requires both a tasks folder and an archive folder. Checked hourly.",
            () => s.autoArchiveEnabled, v => { s.autoArchiveEnabled = v; }, true),
          {
            ...this.numberField("Days to keep done cards",
              "Archive done cards this many days after completion. Set 0 to archive them right away.",
              () => s.autoArchiveAfterDays, n => { s.autoArchiveAfterDays = n; }, 0),
            visible: () => s.autoArchiveEnabled,
          },
          {
            ...this.button("Archive done cards now", "Archive done cards now", () => { void this.plugin.runAutoArchive(true); }),
            visible: () => s.autoArchiveEnabled,
          },
        ],
      },
      {
        type: "group",
        heading: "Pomodoro",
        items: [
          this.toggleField("Enable pomodoro timer",
            "Adds pomodoro start/stop to card menus and a countdown in the status bar.",
            () => s.pomodoroEnabled, v => { s.pomodoroEnabled = v; }, true, () => this.plugin.ensureStatusBar()),
          ...[
            this.numberField("Work duration (minutes)", "", () => s.pomodoroWork,
              n => { s.pomodoroWork = n; }, 1, () => this.plugin.pomodoro.updateSettings(s)),
            this.numberField("Short break (minutes)", "", () => s.pomodoroShortBreak,
              n => { s.pomodoroShortBreak = n; }, 1, () => this.plugin.pomodoro.updateSettings(s)),
            this.numberField("Long break (minutes)", "", () => s.pomodoroLongBreak,
              n => { s.pomodoroLongBreak = n; }, 1, () => this.plugin.pomodoro.updateSettings(s)),
            this.numberField("Long break after (sessions)", "Number of work sessions before a long break.",
              () => s.pomodoroLongBreakInterval, n => { s.pomodoroLongBreakInterval = n; }, 1,
              () => this.plugin.pomodoro.updateSettings(s)),
          ].map(item => ({ ...item, visible: () => s.pomodoroEnabled })),
        ],
      },
      this.columnsList(),
      this.labelColorsList(),
      this.externalCalendarsGroup(),
      {
        type: "group",
        heading: "Recurring tasks",
        visible: () => !!s.recurringConfigPath,
        items: [
          { name: "Recurring config", desc: `Managed via ${s.recurringConfigPath}. Edit the file directly or use these buttons.` },
          this.button("Run recurring check now", "Run recurring check now", () => { void this.plugin.checkRecurring(); }),
          this.button("Open recurring config", "Open recurring config", () => {
            const file = this.app.vault.getAbstractFileByPath(s.recurringConfigPath);
            if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
            else new Notice(`${s.recurringConfigPath} not found`);
          }),
        ],
      },
    ];
  }

  /** Columns: native list with reorder, delete and add. */
  private columnsList(): SettingDefinitionItem {
    const s = this.plugin.settings;
    return {
      type: "list",
      heading: "Columns",
      emptyState: "No columns. Add one, or reset to the defaults.",
      items: s.columns.map(col => ({
        name: col.label || "Untitled column",
        desc: col.rule ? `Rule: ${col.rule}` : "Manual (drag-only)",
        render: (setting: Setting) => {
          setting.addColorPicker(c => c.setValue(col.color || "#778CA3").onChange(v => { col.color = v; this.save(); }));
          setting.addText(t => t.setPlaceholder("Column name").setValue(col.label)
            .onChange(v => { col.label = v; this.save(); }));
          setting.addText(t => t.setPlaceholder("Rule (empty = manual)").setValue(col.rule || "")
            .onChange(v => { col.rule = v || null; this.save(); }));
        },
      })),
      onReorder: (from, to) => {
        const [moved] = s.columns.splice(from, 1);
        s.columns.splice(to, 0, moved);
        void this.saveAndRefresh();
      },
      onDelete: index => {
        s.columns.splice(index, 1);
        void this.saveAndRefresh();
      },
      addItem: {
        name: "Add column",
        action: () => {
          s.columns.push({ id: `custom-${Date.now()}`, label: "New column", color: "#778CA3", rule: null });
          void this.saveAndRefresh();
        },
      },
      extraButtons: [
        b => b.setIcon("rotate-ccw").setTooltip("Reset columns to defaults").onClick(() => {
          s.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS)) as typeof DEFAULT_COLUMNS;
          void this.saveAndRefresh();
        }),
      ],
    };
  }

  /** Label colors: native list; renaming a label moves its color. */
  private labelColorsList(): SettingDefinitionItem {
    const s = this.plugin.settings;
    const labels = Object.keys(s.labelColors);
    return {
      type: "list",
      heading: "Label colors",
      emptyState: "Labels without a custom color get one from a palette automatically.",
      items: labels.map(label => ({
        name: label,
        render: (setting: Setting) => {
          setting.addColorPicker(c => c.setValue(s.labelColors[label]).onChange(v => {
            s.labelColors[label] = v;
            this.save();
          }));
          setting.addText(t => {
            t.setPlaceholder("Label name").setValue(label);
            t.inputEl.addEventListener("change", () => {
              const next = t.getValue().trim();
              if (next && next !== label && !s.labelColors[next]) {
                s.labelColors[next] = s.labelColors[label];
                delete s.labelColors[label];
                void this.saveAndRefresh();
              }
            });
          });
        },
      })),
      onDelete: index => {
        delete s.labelColors[labels[index]];
        void this.saveAndRefresh();
      },
      addItem: {
        name: "Add label color",
        action: () => {
          let name = "New label";
          for (let n = 2; s.labelColors[name]; n++) name = `New label ${n}`;
          s.labelColors[name] = "#778CA3";
          void this.saveAndRefresh();
        },
      },
    };
  }

  /** External calendars: shared options, then one sub-page per calendar. */
  private externalCalendarsGroup(): SettingDefinitionItem {
    const s = this.plugin.settings;
    const sources = s.externalCalendars || [];
    return {
      type: "list",
      heading: "External calendars",
      emptyState: "No external calendars yet. Add one for a client calendar, set its label, then sync.",
      items: [
        {
          name: "How it works",
          desc: "One-way editable import: new events become cards in your tasks folder with the label you choose. Imported cards are never overwritten, so your edits are safe. Skipped automatically: cancelled events, subjects starting with “canceled:” (or its translation, e.g. “abgesagt:”), and blocks with no title.",
          searchable: true,
        },
        {
          name: "How to get a calendar link",
          desc: "Outlook on the web: Calendar > Share > Publish > copy the ICS link. Outlook desktop: Calendar > Publish Online > copy the link. Or export a .ics file into your vault and put its path below instead of a URL.",
        },
        this.numberField("Sync interval (minutes)",
          "How often enabled calendars import new events. Minimum 5. Also syncs hourly and on startup.",
          () => s.externalSyncIntervalMinutes || 60, n => { s.externalSyncIntervalMinutes = n; }, 5),
        this.button("Sync external calendars now", "Sync now", () => { void this.plugin.syncExternalCalendars(true); }),
        ...sources.map(src => this.calendarPage(src)),
      ],
      addItem: {
        name: "Add calendar",
        action: () => {
          sources.push({
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
          s.externalCalendars = sources;
          void this.saveAndRefresh();
        },
      },
    };
  }

  private calendarPage(src: ExternalCalendarSource): SettingDefinitionPage {
    const s = this.plugin.settings;
    return {
      type: "page",
      name: src.name || "Calendar",
      desc: src.enabled === false ? "Disabled" : (src.label ? `Label: ${src.label}` : "No label yet"),
      displayValue: () => (src.lastSync ? `synced ${src.lastSync}` : "not synced yet"),
      status: () => (!src.url && !src.filePath ? "warning" : null),
      items: [
        this.toggleField("Enabled", "Include this calendar when syncing.",
          () => src.enabled !== false, v => { src.enabled = v; }, true),
        this.textField("Name", "Shown in this list.", () => src.name || "", v => { src.name = v; }, "Client calendar"),
        this.textField("Calendar link",
          "Published calendar link (a web or webcal address). Leave empty to use a vault file instead.",
          () => src.url || "", v => { src.url = v; }, "https://outlook.office365.com/owa/calendar/…/calendar.ics"),
        this.textField("Calendar file", "Path to a .ics file in the vault, or on desktop an absolute path to one.",
          () => src.filePath || "", v => { src.filePath = v; }, "Calendars/client.ics"),
        this.textField("Label", "Applied to every imported card. Cards stay in your tasks folder — filter by this label.",
          () => src.label || "", v => { src.label = v; }, "Acme"),
        this.textField("Project", "Set on every imported card and shown as a prefix in brackets. Leave empty for none.",
          () => src.project || "", v => { src.project = v; }, "Acme"),
        this.textField("Source timezone",
          "Time zone the calendar uses. Times convert to your device time. Leave empty when the calendar already uses your time.",
          () => src.timeZone || "", v => { src.timeZone = v; }, "Europe/Zurich"),
        {
          name: "When events disappear",
          desc: "An event deleted at the source leaves no trace. Keep the card, mark it done, or delete it. Only applies inside the sync window.",
          render: (setting: Setting) => {
            setting.addDropdown(d => d
              .addOption("keep", "Keep the card")
              .addOption("done", "Mark done")
              .addOption("delete", "Delete the card")
              .setValue(src.onDisappear || "keep")
              .onChange(v => { src.onDisappear = v as "keep" | "done" | "delete"; this.save(); }));
          },
        },
        this.numberField("Days back", "Import events from this many days ago.", () => src.daysBack ?? 7,
          n => { src.daysBack = Math.min(n, 365); }, 0),
        this.numberField("Days ahead", "Import events up to this many days ahead.", () => src.daysAhead ?? 60,
          n => { src.daysAhead = Math.min(n, 730); }, 1),
        this.button("Import deleted meetings again", "Re-import", () => {
          void this.plugin.reimportDeletedMeetings(src.id);
        }),
        this.button("Remove this calendar", "Remove calendar", () => {
          s.externalCalendars = (s.externalCalendars || []).filter(other => other.id !== src.id);
          void this.saveAndRefresh();
        }),
      ],
    };
  }
}
