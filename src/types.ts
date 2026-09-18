import { TFile } from "obsidian";

export interface CardFrontmatter {
  status?: string;
  due?: string;
  time?: string;
  due_end?: string;
  completed?: string;
  time_spent?: number;
  pomodoros?: number;
  order?: number | null;
  labels?: string[];
  project?: string;
  title?: string;
  source?: string;
  external_uid?: string;
  external_source?: string;
  [key: string]: unknown;
}

export interface ColumnConfig {
  id: string;
  label: string;
  color: string;
  rule: string | null;
}

export interface ExternalCalendarSource {
  id: string;
  name: string;
  /** Published ICS URL (https). Empty when syncing from a vault file instead. */
  url: string;
  /** Vault path to a local .ics file (alternative to url). */
  filePath: string;
  /** Label applied to every card imported from this source. */
  label: string;
  /** Project set on every card imported from this source (shown as [Project] prefix). */
  project: string;
  /** IANA zone the calendar's naive times live in (e.g. "Europe/Zurich"). Empty = device time. */
  timeZone: string;
  /** What to do with imported cards whose event vanished from the calendar. */
  onDisappear: "keep" | "done" | "delete";
  enabled: boolean;
  daysBack: number;
  daysAhead: number;
  lastSync?: string;
}

export interface CockpitBoardSettings {
  folder: string;
  archiveFolder: string;
  autoArchiveEnabled: boolean;
  autoArchiveAfterDays: number;
  recurringConfigPath: string;
  externalCalendars: ExternalCalendarSource[];
  externalSyncIntervalMinutes: number;
  columns: ColumnConfig[];
  enableCustomOrder: boolean;
  cardLabelTint: boolean;
  privacyMode: boolean;
  checklistEditor: boolean;
  cardOpenMode: "split" | "sidebar" | "modal";
  mobileDefaultColumn: string;
  labelColors: Record<string, string>;
  clearDateOnInProgress: boolean;
  notifyLeadMinutes: string;
  notifySystem: boolean;
  pomodoroEnabled: boolean;
  pomodoroWork: number;
  pomodoroShortBreak: number;
  pomodoroLongBreak: number;
  pomodoroLongBreakInterval: number;
}

export interface CardData {
  file: TFile;
  rawStatus: string;
  title: string;
  project: string;
  due: string;
  time: string;
  dueEnd: string;
  completed: string;
  timeSpent: number;
  pomodoros: number;
  source: string;
  labels: string[];
  order: number | null;
  checkedCount: number;
  totalChecks: number;
  hasDesc: boolean;
  column: string;
  readonly displayTitle: string;
}

export interface RecurringRule {
  title: string;
  cron: string;
  labels?: string[];
  project?: string;
  frequency?: string;
}

export interface RecurringConfig {
  _comment?: string;
  _format?: string;
  tasks: RecurringRule[];
}

export interface TimerData {
  startTime: number;
  previousMinutes: number;
}

export interface PomodoroSession {
  cardPath: string;
  startTime: number;
  phase: "work" | "short-break" | "long-break";
  sessionCount: number;
}

export interface ArchiveResult {
  path: string;
  title: string;
  completed: string;
  project: string;
  labels: string[];
}

export interface CalendarCardData {
  file: TFile;
  title: string;
  displayTitle: string;
  due: string;
  dueEnd: string;
  time: string;
  project: string;
  labels: string[];
  rawStatus: string;
  completed: string;
  column: string;
}
