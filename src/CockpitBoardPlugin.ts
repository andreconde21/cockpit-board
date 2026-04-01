import { Plugin, TFile } from "obsidian";
import type { CockpitBoardSettings, TimerData } from "./types";
import { VIEW_TYPE, DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";
import { CockpitBoardView } from "./CockpitBoardView";
import { CockpitBoardSettingTab } from "./CockpitBoardSettingTab";
import { checkRecurring } from "./recurring";
import { scheduleNotifications } from "./notifications";

export default class CockpitBoardPlugin extends Plugin {
  settings!: CockpitBoardSettings;
  activeTimers = new Map<string, TimerData>();
  private _dismissedRecurring: Record<string, string> = {};
  private _notifiedToday = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new CockpitBoardView(leaf, this));

    this.addCommand({
      id: "open",
      name: "Open board",
      callback: () => { void this.activateView(); },
    });

    this.addCommand({
      id: "open-archive",
      name: "Open archive search",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          (leaf.view as CockpitBoardView).showArchive = true;
          void (leaf.view as CockpitBoardView).render();
        }
      },
    });

    this.addCommand({
      id: "open-calendar",
      name: "Open calendar view",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          const view = leaf.view as CockpitBoardView;
          view.showCalendar = true;
          view.showArchive = false;
          void view.render();
        }
      },
    });

    this.addRibbonIcon("layout-grid", "Cockpit Board", () => { void this.activateView(); });
    this.addSettingTab(new CockpitBoardSettingTab(this.app, this));

    // Timer tick — update active timer displays every 10 seconds
    this.registerInterval(window.setInterval(() => {
      for (const [path, timer] of this.activeTimers) {
        const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
        const el = document.querySelector(`.cockpit-card[data-path="${CSS.escape(path)}"] .cockpit-timer-display`);
        if (el) {
          const h = Math.floor(elapsed / 60);
          const m = elapsed % 60;
          el.textContent = h > 0 ? `\u25B6 ${h}h${m}m` : `\u25B6 ${m}m`;
        }
      }
    }, 10000));

    // Track deleted recurring tasks
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (this.settings.folder && file.path?.startsWith(this.settings.folder) && file.name?.includes("-recurring")) {
        const slug = file.name.replace("-recurring.md", "");
        void this.dismissRecurringTask(slug);
      }
    }));

    this.app.workspace.onLayoutReady(() => {
      void this.loadDismissedRecurring().then(() => {
        void this.checkRecurring();
        this.runNotifications();
      });
    });

    // Recurring check every hour
    this.registerInterval(window.setInterval(() => {
      void this.checkRecurring();
      this.runNotifications();
    }, 3600000));

    // Notification check every 5 minutes
    this.registerInterval(window.setInterval(() => {
      this.runNotifications();
    }, 300000));
  }

  onunload(): void {
    for (const [path, timer] of this.activeTimers) {
      const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        void this.app.fileManager.processFrontMatter(file, (fm) => { fm.time_spent = elapsed; });
      }
    }
    this.activeTimers.clear();
  }

  async checkRecurring(): Promise<void> {
    const created = await checkRecurring(this.settings, this._dismissedRecurring, this.app);
    if (created.length > 0) {
      await this.saveDismissedRecurring();
    }
  }

  private runNotifications(): void {
    scheduleNotifications(this.settings, this._notifiedToday, this.app);
  }

  private async loadDismissedRecurring(): Promise<void> {
    try {
      const data = await this.loadData();
      this._dismissedRecurring = data?._dismissedRecurring || {};
    } catch {
      this._dismissedRecurring = {};
    }
    const today = new Date().toISOString().split("T")[0];
    for (const key of Object.keys(this._dismissedRecurring)) {
      if (this._dismissedRecurring[key] !== today) delete this._dismissedRecurring[key];
    }
  }

  private async saveDismissedRecurring(): Promise<void> {
    const data = await this.loadData() || {};
    data._dismissedRecurring = this._dismissedRecurring;
    await this.saveData(data);
  }

  async dismissRecurringTask(slug: string): Promise<void> {
    this._dismissedRecurring[slug] = new Date().toISOString().split("T")[0];
    await this.saveDismissedRecurring();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = Object.assign(
      {},
      JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      saved,
    );
    delete (this.settings as unknown as Record<string, unknown>)._dismissedRecurring;

    if (!this.settings.columns || this.settings.columns.length === 0) {
      this.settings.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    }
  }

  async saveSettings(): Promise<void> {
    const data = await this.loadData() || {};
    const dismissed = data._dismissedRecurring;
    const toSave = { ...this.settings } as Record<string, unknown>;
    if (dismissed) toSave._dismissedRecurring = dismissed;
    await this.saveData(toSave);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE, state: {} });
  }
}
