import { TFile } from "obsidian";
import type { CardData, CardFrontmatter, ColumnConfig } from "./types";
import { resolveColumn } from "./rule-engine";
import { fmStr } from "./ui/dom-helpers.js";

export class CockpitCard implements CardData {
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

  constructor(file: TFile, fm: CardFrontmatter, content: string, columns: ColumnConfig[]) {
    this.file = file;
    this.rawStatus = fmStr(fm.status).trim().toLowerCase();
    this.title = fmStr(fm.title) || file.basename;
    this.project = fmStr(fm.project);
    this.due = fmStr(fm.due);
    this.time = fmStr(fm.time);
    this.dueEnd = fmStr(fm.due_end);
    this.completed = fmStr(fm.completed);
    this.timeSpent = fm.time_spent ? Number(fm.time_spent) : 0;
    this.pomodoros = fm.pomodoros ? Number(fm.pomodoros) : 0;
    this.source = fmStr(fm.source);
    this.labels = Array.isArray(fm.labels) ? fm.labels.filter(Boolean) : [];
    const orderMatch = content.match(/^order:\s*(\d+)/m);
    this.order = orderMatch ? Number(orderMatch[1]) : (fm.order != null ? Number(fm.order) : null);
    this.checkedCount = (content.match(/^- \[x\]/gm) || []).length;
    this.totalChecks = (content.match(/^- \[.\]/gm) || []).length;
    const body = content.split("---").slice(2).join("---");
    this.hasDesc = body.split("\n").some(l =>
      l.trim() !== "" && !l.startsWith("#") && !l.startsWith("- [") && !l.startsWith("> ") && !l.startsWith("## ")
    );
    this.column = resolveColumn(this, columns);
  }

  get displayTitle(): string {
    if (!this.project) return this.title;

    const wikilinkMatch = this.project.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    const projectLabel = (wikilinkMatch?.[2] || wikilinkMatch?.[1] || this.project).trim();
    return `[${projectLabel}] ${this.title}`;
  }
}
