import { Plugin, TFile } from "obsidian";
import type { CockpitBoardSettings, TimerData, PomodoroSession } from "./types";
import { VIEW_TYPE, DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";
import { CockpitBoardView } from "./CockpitBoardView";
import { CockpitBoardSettingTab } from "./CockpitBoardSettingTab";
import { checkRecurring } from "./recurring";
import { scheduleNotifications } from "./notifications";
import { PomodoroEngine } from "./pomodoro";

export default class CockpitBoardPlugin extends Plugin {
  settings!: CockpitBoardSettings;
  activeTimers = new Map<string, TimerData>();
  pomodoro!: PomodoroEngine;
  private _dismissedRecurring: Record<string, string> = {};
  private _notifiedToday = new Set<string>();
  private _statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.pomodoro = new PomodoroEngine(
      this.settings,
      () => this.updateStatusBar(),
      (session) => { void this.onPomodoroWorkComplete(session); },
    );

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

    this.addRibbonIcon("layout-grid", "Cockpit board", () => { void this.activateView(); });
    this.addSettingTab(new CockpitBoardSettingTab(this.app, this));

    // Status bar for pomodoro
    if (this.settings.pomodoroEnabled) {
      this._statusBarEl = this.addStatusBarItem();
      this._statusBarEl.setText("");
    }

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
        void this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.time_spent = elapsed; });
      }
    }
    this.activeTimers.clear();
    this.pomodoro.destroy();
  }

  // ── Pomodoro ──
  startPomodoro(cardPath: string): void {
    // Stop any free-form timer on this card
    if (this.activeTimers.has(cardPath)) {
      const timer = this.activeTimers.get(cardPath)!;
      const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
      this.activeTimers.delete(cardPath);
      const file = this.app.vault.getAbstractFileByPath(cardPath);
      if (file instanceof TFile) {
        void this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.time_spent = elapsed; });
      }
    }
    this.pomodoro.start(cardPath);
    this.updateStatusBar();
  }

  stopPomodoro(): void {
    this.pomodoro.stop();
    this.updateStatusBar();
  }

  private async onPomodoroWorkComplete(session: PomodoroSession): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(session.cardPath);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.pomodoros = (typeof fm.pomodoros === "number" ? fm.pomodoros : 0) + 1;
        fm.time_spent = (typeof fm.time_spent === "number" ? fm.time_spent : 0) + this.settings.pomodoroWork;
      });
    }
    // Refresh the board to show updated pomodoro count
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf?.view) void (leaf.view as CockpitBoardView).render();
  }

  private updateStatusBar(): void {
    if (!this._statusBarEl) {
      if (this.settings.pomodoroEnabled) {
        this._statusBarEl = this.addStatusBarItem();
      } else return;
    }
    const text = this.pomodoro.getStatusText();
    this._statusBarEl.setText(text);
  }

  ensureStatusBar(): void {
    if (this.settings.pomodoroEnabled && !this._statusBarEl) {
      this._statusBarEl = this.addStatusBarItem();
    }
    if (!this.settings.pomodoroEnabled && this._statusBarEl) {
      this._statusBarEl.remove();
      this._statusBarEl = null;
    }
    this.pomodoro.updateSettings(this.settings);
  }

  // ── Recurring ──
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
      const data = (await this.loadData()) as Record<string, unknown> | null;
      this._dismissedRecurring = (data?._dismissedRecurring as Record<string, string>) || {};
    } catch {
      this._dismissedRecurring = {};
    }
    const today = new Date().toISOString().split("T")[0];
    for (const key of Object.keys(this._dismissedRecurring)) {
      if (this._dismissedRecurring[key] !== today) delete this._dismissedRecurring[key];
    }
  }

  private async saveDismissedRecurring(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) || {};
    data._dismissedRecurring = this._dismissedRecurring;
    await this.saveData(data);
  }

  async dismissRecurringTask(slug: string): Promise<void> {
    this._dismissedRecurring[slug] = new Date().toISOString().split("T")[0];
    await this.saveDismissedRecurring();
  }

  // ── Settings ──
  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Record<string, unknown> | null;
    this.settings = Object.assign(
      {},
      JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CockpitBoardSettings,
      saved,
    ) as CockpitBoardSettings;
    delete (this.settings as unknown as Record<string, unknown>)._dismissedRecurring;

    if (!this.settings.columns || this.settings.columns.length === 0) {
      this.settings.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS)) as CockpitBoardSettings["columns"];
    }
  }

  async saveSettings(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) || {};
    const dismissed = data._dismissedRecurring as Record<string, string> | undefined;
    const toSave = { ...this.settings } as Record<string, unknown>;
    if (dismissed) toSave._dismissedRecurring = dismissed;
    await this.saveData(toSave);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE, state: {} });
  }
}
