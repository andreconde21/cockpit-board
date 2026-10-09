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
  /** Give new cards a short `id:` (prefix + number). */
  assignCardIds: boolean;
  cardIdPrefix: string;
  showCardId: boolean;
  /** Master switch: no agent menu item, no process started while off. */
  agentLauncherEnabled: boolean;
  agentProfiles: AgentProfile[];
  defaultAgentId: string;
  agentPromptTemplate: string;
  agentLocal: AgentLocalSettings;
  /** Per-machine overrides, keyed by machine name. */
  machineOverrides: Record<string, MachineOverride>;
  /** Machines added by hand (SSH alias or user@host). */
  manualMachines: string[];
  agentRecordRuns: boolean;
}

export type SessionMode = "herdr" | "terminal" | "tmux";
export type CardDelivery = "inline" | "upload" | "shared";

export interface AgentProfile {
  id: string;
  name: string;
  /** Executable name or absolute path. */
  command: string;
  /** Extra arguments, whitespace separated (double quotes group). */
  args: string;
  /** Value for `herdr agent start --kind`; empty starts it with `pane run`. */
  herdrKind: string;
  /** Empty = the global template. */
  promptTemplate: string;
}

export interface AgentLocalSettings {
  /** Empty = vault root. */
  cwd: string;
  /** Empty = herdr when installed, else new terminal. */
  sessionMode: SessionMode | "";
  /** Empty = the OS default. `{script}` is replaced with the launch script path. */
  terminalCommand: string;
  tmuxSession: string;
  attachTmux: boolean;
  /** Empty = found on the login PATH. */
  herdrPath: string;
  tmuxPath: string;
  sshPath: string;
}

export interface MachineOverride {
  /** Empty = the machine name (or herdr's SSH target). */
  sshTarget: string;
  /** Empty = remote home. */
  cwd: string;
  /** Empty = default agent. */
  agentId: string;
  sessionMode: SessionMode | "";
  delivery: CardDelivery | "";
  /** Shared folder as seen on this computer. */
  sharedLocal: string;
  /** The same folder as seen on the machine. */
  sharedRemote: string;
  hidden: boolean;
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
  /** The `id:` frontmatter value, "" when the card has none. */
  id: string;
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
