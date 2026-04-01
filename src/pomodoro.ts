import { Notice } from "obsidian";
import type { CockpitBoardSettings, PomodoroSession } from "./types";

export class PomodoroEngine {
  session: PomodoroSession | null = null;
  private tickInterval: number | null = null;
  private settings: CockpitBoardSettings;
  private onTick: () => void;
  private onPhaseComplete: (session: PomodoroSession) => void;

  constructor(
    settings: CockpitBoardSettings,
    onTick: () => void,
    onPhaseComplete: (session: PomodoroSession) => void,
  ) {
    this.settings = settings;
    this.onTick = onTick;
    this.onPhaseComplete = onPhaseComplete;
  }

  updateSettings(settings: CockpitBoardSettings): void {
    this.settings = settings;
  }

  start(cardPath: string): void {
    this.stop();
    this.session = {
      cardPath,
      startTime: Date.now(),
      phase: "work",
      sessionCount: 0,
    };
    this.startTick();
    new Notice(`\uD83C\uDF45 Pomodoro started (${this.settings.pomodoroWork}m)`, 3000);
  }

  stop(): void {
    if (this.tickInterval !== null) {
      window.clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.session) {
      new Notice("\uD83C\uDF45 Pomodoro stopped", 2000);
      this.session = null;
    }
  }

  isActive(): boolean {
    return this.session !== null;
  }

  isActiveFor(cardPath: string): boolean {
    return this.session?.cardPath === cardPath;
  }

  getTimeRemaining(): number {
    if (!this.session) return 0;
    const duration = this.getPhaseDuration() * 60000;
    const elapsed = Date.now() - this.session.startTime;
    return Math.max(0, duration - elapsed);
  }

  formatTimeRemaining(): string {
    const ms = this.getTimeRemaining();
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  getStatusText(): string {
    if (!this.session) return "";
    const time = this.formatTimeRemaining();
    if (this.session.phase === "work") {
      const current = this.session.sessionCount + 1;
      const total = this.settings.pomodoroLongBreakInterval;
      return `\uD83C\uDF45 ${current}/${total} \u2014 ${time}`;
    }
    return `\u2615 ${time}`;
  }

  private getPhaseDuration(): number {
    if (!this.session) return 0;
    switch (this.session.phase) {
      case "work": return this.settings.pomodoroWork;
      case "short-break": return this.settings.pomodoroShortBreak;
      case "long-break": return this.settings.pomodoroLongBreak;
    }
  }

  private startTick(): void {
    if (this.tickInterval !== null) window.clearInterval(this.tickInterval);
    this.tickInterval = window.setInterval(() => {
      if (!this.session) return;
      const remaining = this.getTimeRemaining();
      if (remaining <= 0) {
        this.completePhase();
      }
      this.onTick();
    }, 1000);
  }

  private completePhase(): void {
    if (!this.session) return;

    if (this.session.phase === "work") {
      this.session.sessionCount++;
      this.onPhaseComplete({ ...this.session });

      const isLongBreak = this.session.sessionCount % this.settings.pomodoroLongBreakInterval === 0;
      if (isLongBreak) {
        this.session.phase = "long-break";
        new Notice(`\uD83C\uDF45 ${this.session.sessionCount} sessions done! Take a ${this.settings.pomodoroLongBreak}m break.`, 8000);
      } else {
        this.session.phase = "short-break";
        new Notice(`\uD83C\uDF45 Session done! Take a ${this.settings.pomodoroShortBreak}m break.`, 5000);
      }
      this.session.startTime = Date.now();
    } else {
      // Break is over → start next work session
      this.session.phase = "work";
      this.session.startTime = Date.now();
      new Notice(`\uD83C\uDF45 Break over! Starting session ${this.session.sessionCount + 1}.`, 5000);
    }
  }

  destroy(): void {
    if (this.tickInterval !== null) {
      window.clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.session = null;
  }
}
