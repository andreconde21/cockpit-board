import type { CardData, ColumnConfig, CockpitBoardSettings } from "./types";
import { todayStr, getToday, getTomorrow, parseDate } from "./ui/dom-helpers";

export function matchesRule(card: CardData, rule: string): boolean {
  if (!rule) return false;
  if (rule.includes(" AND ")) return rule.split(" AND ").every(r => matchesRule(card, r.trim()));
  if (rule.startsWith("NOT ")) return !matchesRule(card, rule.slice(4));
  if (rule.startsWith("status:")) return card.rawStatus === rule.split(":")[1];
  if (rule.startsWith("label:")) return card.labels.includes(rule.split(":")[1]);
  if (rule === "no-date") return !card.due;
  if (rule === "date:today") {
    const d = parseDate(card.due);
    const dEnd = parseDate(card.dueEnd);
    const t = getToday();
    return (d !== null && d <= t && (!dEnd || dEnd >= t)) || (d !== null && d.getTime() === t.getTime());
  }
  if (rule === "date:tomorrow") {
    const d = parseDate(card.due);
    return d !== null && d > getToday() && d <= getTomorrow();
  }
  if (rule === "date:future") {
    const d = parseDate(card.due);
    return d !== null && d > getTomorrow();
  }
  return false;
}

export function resolveColumn(card: CardData, columns: ColumnConfig[]): string {
  // Priority 1: exact status match (done, in-progress, pending)
  for (const col of columns) {
    if (!col.rule) continue;
    if (col.rule.startsWith("status:") && matchesRule(card, col.rule)) return col.id;
  }
  // Priority 2: date and label rules
  for (const col of columns) {
    if (!col.rule) continue;
    if (col.rule.startsWith("status:")) continue;
    if (matchesRule(card, col.rule)) return col.id;
  }
  return columns[0]?.id || "backlog";
}

export function getDropUpdates(col: ColumnConfig, currentCard: CardData, settings?: CockpitBoardSettings): Record<string, string> {
  const updates: Record<string, string> = {};
  const rule = col.rule || "";
  const adjustDate = settings?.adjustDateOnMove ?? false;
  const setToday = settings?.setTodayOnMove ?? false;

  if (rule.includes("status:")) {
    const status = rule.match(/status:(\S+)/)?.[1] || col.id;
    updates.status = status;
    if (status === "done") updates.completed = todayStr();
  } else if (rule.includes("date:today")) {
    updates.status = "scheduled";
    // When setTodayOnMove is on, always overwrite date to today
    if (setToday || !currentCard.due) {
      updates.due = todayStr();
    }
  } else if (rule.includes("date:tomorrow")) {
    updates.status = "scheduled";
    // When adjustDateOnMove is on, always overwrite date to tomorrow
    if (adjustDate || !currentCard.due) {
      updates.due = getTomorrow().toISOString().split("T")[0];
    }
  } else if (rule.includes("date:future")) {
    updates.status = "scheduled";
    // When adjustDateOnMove is on and card has a past/today/tomorrow date, push it forward
    if (adjustDate && currentCard.due) {
      const d = parseDate(currentCard.due);
      if (d && d <= getTomorrow()) {
        const future = new Date(getTomorrow());
        future.setDate(future.getDate() + 1);
        updates.due = future.toISOString().split("T")[0];
      }
    }
  } else if (rule.includes("no-date")) {
    updates.status = "";
    updates.due = "";
    if (rule.includes("label:")) {
      const labelMatch = rule.match(/label:(\S+)/);
      if (labelMatch && !rule.includes("NOT label:")) {
        updates._addLabel = labelMatch[1];
      }
    }
    if (rule.includes("NOT label:")) {
      const notMatch = rule.match(/NOT label:(\S+)/);
      if (notMatch) updates._removeLabel = notMatch[1];
    }
  } else if (!rule) {
    updates.status = col.id;
  }

  return updates;
}
