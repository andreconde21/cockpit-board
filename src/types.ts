import { TFile } from "obsidian";

export interface ColumnConfig {
  id: string;
  label: string;
  color: string;
  rule: string | null;
}

export interface CockpitBoardSettings {
  folder: string;
  archiveFolder: string;
  recurringConfigPath: string;
  columns: ColumnConfig[];
  enableCustomOrder: boolean;
  cardLabelTint: boolean;
  privacyMode: boolean;
  checklistEditor: boolean;
  cardOpenMode: "split" | "sidebar" | "modal";
  mobileDefaultColumn: string;
  labelColors: Record<string, string>;
  clearDateOnInProgress: boolean;
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
