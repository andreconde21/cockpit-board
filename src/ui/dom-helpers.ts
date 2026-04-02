import { DEFAULT_PALETTE } from "../constants";
import type { CockpitBoardSettings } from "../types";

/** Safely extract a string from a frontmatter value that may be an object. */
export function fmStr(val: unknown): string {
  return typeof val === "string" ? val : "";
}

/** Format a Date as YYYY-MM-DD in local time (not UTC). */
export function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return formatDateLocal(new Date());
}

export function getToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getTomorrow(): Date {
  const d = getToday();
  d.setDate(d.getDate() + 1);
  return d;
}

export function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function datePillClass(dueStr: string): string | null {
  if (!dueStr) return null;
  const due = parseDate(dueStr);
  if (!due) return null;
  if (due < getToday()) return "cockpit-date-overdue";
  if (due <= getTomorrow()) return "cockpit-date-soon";
  return "cockpit-date-future";
}

export function formatDueDisplay(dueStr: string, timeStr: string, dueEndStr: string): string | null {
  if (!dueStr) return null;
  const due = parseDate(dueStr);
  if (!due) return null;
  const parts: string[] = [];
  if (timeStr) parts.push(timeStr);
  const month = due.toLocaleString("en-US", { month: "short" });
  let dateText = `${month} ${due.getDate()}`;
  if (due.getFullYear() !== new Date().getFullYear()) dateText += ` ${due.getFullYear()}`;
  if (dueEndStr) {
    const end = parseDate(dueEndStr);
    if (end) {
      const endMonth = end.toLocaleString("en-US", { month: "short" });
      if (endMonth === month && end.getFullYear() === due.getFullYear()) {
        dateText += ` \u2013 ${end.getDate()}`;
      } else {
        let endText = `${endMonth} ${end.getDate()}`;
        if (end.getFullYear() !== new Date().getFullYear()) endText += ` ${end.getFullYear()}`;
        dateText += ` \u2013 ${endText}`;
      }
    }
  }
  parts.push(dateText);
  return parts.join(" ");
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getLabelColor(label: string, settings: CockpitBoardSettings): string {
  if (settings.labelColors[label]) return settings.labelColors[label];
  return DEFAULT_PALETTE[hashString(label) % DEFAULT_PALETTE.length];
}
