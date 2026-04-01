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
  recurringConfigPath: "",
  columns: DEFAULT_COLUMNS,
  enableCustomOrder: true,
  cardLabelTint: false,
  privacyMode: false,
  checklistEditor: true,
  cardOpenMode: "split",
  mobileDefaultColumn: "in-progress",
  labelColors: {},
};

export const DEFAULT_PALETTE = [
  "#519CE4", "#0079BF", "#055A8C", "#C377E0", "#51E898",
  "#61BD4F", "#86E07A", "#519839", "#EB5A46", "#F2D600",
  "#B3BAC5", "#8FDFEB", "#00C2E0", "#FF78CB",
];
