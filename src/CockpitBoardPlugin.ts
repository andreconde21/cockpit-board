import { Notice, Plugin, TFile } from "obsidian";
import type { CardFrontmatter, CockpitBoardSettings, TimerData, PomodoroSession } from "./types";
import { VIEW_TYPE, DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";
import { CockpitBoardView } from "./CockpitBoardView";
import { CockpitBoardSettingTab } from "./CockpitBoardSettingTab";
import { checkRecurring } from "./recurring";
import { archiveDoneCards } from "./archive/AutoArchive";
import { syncAllExternalCalendars, type ExternalSeenMap } from "./external-calendar/sync";
import { scheduleNotifications } from "./notifications";
import { PomodoroEngine } from "./pomodoro";
import { todayStr } from "./ui/dom-helpers.js";
import { isInFolder } from "./vault-helpers";

export default class CockpitBoardPlugin extends Plugin {
  settings!: CockpitBoardSettings;
  activeTimers = new Map<string, TimerData>();
  pomodoro!: PomodoroEngine;
  private _dismissedRecurring: Record<string, string> = {};
  private _externalSeen: ExternalSeenMap = {};
  private _externalSyncing = false;
  private _lastExternalSyncMs = 0;
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
      callback: () => {
        void (async () => {
          await this.activateView();
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf?.view) {
            (leaf.view as CockpitBoardView).showArchive = true;
            void (leaf.view as CockpitBoardView).render();
          }
        })();
      },
    });

    this.addCommand({
      id: "open-calendar",
      name: "Open calendar view",
      callback: () => {
        void (async () => {
          await this.activateView();
          const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
          if (leaf?.view) {
            const view = leaf.view as CockpitBoardView;
            view.showCalendar = true;
            view.showArchive = false;
            void view.render();
          }
        })();
      },
    });

    this.addCommand({
      id: "archive-done",
      name: "Archive done cards now",
      callback: () => { void this.runAutoArchive(true); },
    });

    this.addCommand({
      id: "sync-external-calendars",
      name: "Sync external calendars now",
      callback: () => { void this.syncExternalCalendars(true); },
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
        const el = activeDocument.querySelector(`.cockpit-card[data-path="${CSS.escape(path)}"] .cockpit-timer-display`);
        if (el) {
          const h = Math.floor(elapsed / 60);
          const m = elapsed % 60;
          el.textContent = h > 0 ? `\u25B6 ${h}h${m}m` : `\u25B6 ${m}m`;
        }
      }
    }, 10000));

    // Track deleted recurring tasks
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (isInFolder(file.path, this.settings.folder) && file.name.includes("-recurring")) {
        const slug = file.name.replace("-recurring.md", "");
        void this.dismissRecurringTask(slug);
      }
    }));

    this.app.workspace.onLayoutReady(() => {
      void this.loadDismissedRecurring().then(() => {
        void this.checkRecurring();
        this.runNotifications();
        if (this.settings.autoArchiveEnabled) void this.runAutoArchive();
        void this.syncExternalCalendars(false);
      });
    });

    // Recurring + auto-archive check every hour
    this.registerInterval(window.setInterval(() => {
      void this.checkRecurring();
      this.runNotifications();
      if (this.settings.autoArchiveEnabled) void this.runAutoArchive();
      void this.syncExternalCalendars(false);
    }, 3600000));

    // External calendar ticker — honors the configured interval without
    // re-registering when settings change. Checked every minute.
    this.registerInterval(window.setInterval(() => {
      const minutes = Math.max(5, this.settings.externalSyncIntervalMinutes || 60);
      if (Date.now() - this._lastExternalSyncMs >= minutes * 60000) {
        void this.syncExternalCalendars(false);
      }
    }, 60000));

    // Notification check every 30 seconds — a one-minute lead time cannot
    // fire reliably on a coarser tick.
    this.registerInterval(window.setInterval(() => {
      this.runNotifications();
    }, 30000));
  }

  onunload(): void {
    for (const [path, timer] of this.activeTimers) {
      const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        void this.app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => { fm.time_spent = elapsed; });
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
        void this.app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => { fm.time_spent = elapsed; });
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
      await this.app.fileManager.processFrontMatter(file, (fm: CardFrontmatter) => {
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

  // ── External calendars (one-way editable import) ──
  async syncExternalCalendars(manual = false): Promise<void> {
    const sources = this.settings.externalCalendars || [];
    if (!sources.some((s) => s.enabled && (s.url.trim() || s.filePath.trim()))) {
      if (manual) new Notice("Add an external calendar in settings first (ICS URL or .ics file).");
      return;
    }
    if (!this.settings.folder) {
      if (manual) new Notice("Set a tasks folder in settings first.");
      return;
    }
    if (this._externalSyncing) return;
    this._externalSyncing = true;
    try {
      const results = await syncAllExternalCalendars(this.app, this.settings, this._externalSeen, {
        notify: manual,
      });
      this._lastExternalSyncMs = Date.now();
      await this.saveExternalSeen();
      await this.saveSettings();
      const created = results.reduce((n, r) => n + r.created, 0);
      if (created > 0) {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) void (leaf.view as CockpitBoardView).render();
      }
    } finally {
      this._externalSyncing = false;
    }
  }

  // ── Auto-archive ──
  async runAutoArchive(manual = false): Promise<void> {
    if (!this.settings.folder || !this.settings.archiveFolder) {
      if (manual) new Notice("Set both a tasks folder and an archive folder in settings first.");
      return;
    }
    const { moved, skipped } = await archiveDoneCards(this.app, this.settings);
    const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
    if (manual) {
      new Notice(`Archived ${cards(moved)}${skipped > 0 ? `, skipped ${skipped}` : ""}`);
    } else if (moved > 0) {
      new Notice(`Cockpit board: archived ${cards(moved)}`);
    }
    if (moved > 0) {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (leaf?.view) void (leaf.view as CockpitBoardView).render();
    }
  }

  private runNotifications(): void {
    scheduleNotifications(this.settings, this._notifiedToday, this.app);
  }

  private async loadDismissedRecurring(): Promise<void> {
    try {
      const data = (await this.loadData()) as Record<string, unknown> | null;
      this._dismissedRecurring = (data?._dismissedRecurring as Record<string, string>) || {};
      this._externalSeen = (data?._externalSeen as ExternalSeenMap) || {};
    } catch {
      this._dismissedRecurring = {};
      this._externalSeen = {};
    }
    const today = todayStr();
    for (const key of Object.keys(this._dismissedRecurring)) {
      if (this._dismissedRecurring[key] !== today) delete this._dismissedRecurring[key];
    }
  }

  private async saveDismissedRecurring(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) || {};
    data._dismissedRecurring = this._dismissedRecurring;
    await this.saveData(data);
  }

  private async saveExternalSeen(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) || {};
    data._externalSeen = this._externalSeen;
    await this.saveData(data);
  }

  async dismissRecurringTask(slug: string): Promise<void> {
    this._dismissedRecurring[slug] = todayStr();
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
    delete (this.settings as unknown as Record<string, unknown>)._externalSeen;

    if (!this.settings.columns || this.settings.columns.length === 0) {
      this.settings.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS)) as CockpitBoardSettings["columns"];
    }
    if (!Array.isArray(this.settings.externalCalendars)) {
      this.settings.externalCalendars = [];
    }
    for (const src of this.settings.externalCalendars) {
      if (!src.id) src.id = `ext-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      if (typeof src.enabled !== "boolean") src.enabled = true;
      if (typeof src.url !== "string") src.url = "";
      if (typeof src.filePath !== "string") src.filePath = "";
      if (typeof src.label !== "string") src.label = "";
      if (typeof src.project !== "string") src.project = "";
      if (typeof src.timeZone !== "string") src.timeZone = "";
      if (src.onDisappear !== "done" && src.onDisappear !== "delete") src.onDisappear = "keep";
      if (typeof src.name !== "string") src.name = "";
      if (typeof src.daysBack !== "number" || isNaN(src.daysBack)) src.daysBack = 7;
      if (typeof src.daysAhead !== "number" || isNaN(src.daysAhead)) src.daysAhead = 60;
    }
    if (typeof this.settings.externalSyncIntervalMinutes !== "number" ||
      isNaN(this.settings.externalSyncIntervalMinutes)) {
      this.settings.externalSyncIntervalMinutes = 60;
    }
  }

  async saveSettings(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) || {};
    const dismissed = data._dismissedRecurring as Record<string, string> | undefined;
    const externalSeen = data._externalSeen as ExternalSeenMap | undefined;
    const toSave = { ...this.settings } as Record<string, unknown>;
    if (dismissed) toSave._dismissedRecurring = dismissed;
    if (externalSeen) toSave._externalSeen = externalSeen;
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
