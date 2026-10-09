import type { ColumnConfig, CockpitBoardSettings } from "./types";

export const VIEW_TYPE = "cockpit-board-view";

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "backlog", label: "Backlog", color: "#778CA3", rule: "no-date" },
  { id: "scheduled", label: "Scheduled", color: "#45B7D1", rule: "date:future" },
  { id: "soon", label: "Soon", color: "#F7B731", rule: "date:tomorrow" },
  { id: "today", label: "Today", color: "#FC5C65", rule: "date:today" },
  { id: "in-progress", label: "In Progress", color: "#0079BF", rule: "status:in-progress" },
  { id: "done", label: "Done", color: "#61BD4F", rule: "status:done" },
];

export const DEFAULT_SETTINGS: CockpitBoardSettings = {
  folder: "",
  archiveFolder: "",
  autoArchiveEnabled: false,
  autoArchiveAfterDays: 7,
  recurringConfigPath: "",
  externalCalendars: [],
  externalSyncIntervalMinutes: 60,
  columns: DEFAULT_COLUMNS,
  enableCustomOrder: true,
  cardLabelTint: false,
  privacyMode: false,
  checklistEditor: true,
  cardOpenMode: "split",
  mobileDefaultColumn: "in-progress",
  labelColors: {},
  clearDateOnInProgress: true,
  notifyLeadMinutes: "15,1",
  notifySystem: true,
  pomodoroEnabled: false,
  pomodoroWork: 25,
  pomodoroShortBreak: 5,
  pomodoroLongBreak: 15,
  pomodoroLongBreakInterval: 4,
  assignCardIds: false,
  cardIdPrefix: "CB",
  showCardId: true,
  agentLauncherEnabled: false,
  agentProfiles: [
    { id: "claude", name: "Claude", command: "claude", args: "", herdrKind: "claude", promptTemplate: "" },
  ],
  defaultAgentId: "claude",
  agentPromptTemplate:
    "You are working on this Cockpit Board card. Read it, do the work, and add a short \"## Agent notes\" section to the card file when you are done.\n\n{{context}}",
  agentLocal: {
    cwd: "",
    sessionMode: "",
    terminalCommand: "",
    tmuxSession: "cockpit",
    attachTmux: true,
    herdrPath: "",
    tmuxPath: "",
    sshPath: "",
  },
  machineOverrides: {},
  manualMachines: [],
  agentRecordRuns: true,
};

/** Agent presets offered when adding a profile. None bypasses permissions. */
export const AGENT_PRESETS = [
  { name: "Claude", command: "claude", herdrKind: "claude" },
  { name: "Codex", command: "codex", herdrKind: "codex" },
  { name: "Gemini", command: "gemini", herdrKind: "gemini" },
  { name: "Custom", command: "", herdrKind: "" },
];

/** `source:` values for cards whose text was written by someone else. */
export const OUTSIDE_SOURCES = ["external-calendar", "email"];

export const DEFAULT_PALETTE = [
  "#519CE4", "#0079BF", "#055A8C", "#C377E0", "#51E898",
  "#61BD4F", "#86E07A", "#519839", "#EB5A46", "#F2D600",
  "#B3BAC5", "#8FDFEB", "#00C2E0", "#FF78CB",
];
