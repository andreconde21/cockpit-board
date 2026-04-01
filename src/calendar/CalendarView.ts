import type { CardData, CalendarCardData, CockpitBoardSettings } from "../types";
import { renderWeekView } from "./WeekView";
import { renderMonthView } from "./MonthView";
import { renderYearView, hideYearTooltip } from "./YearView";

export { hideYearTooltip };

export interface CalendarViewContext {
  calendarDate: Date;
  calendarMode: "week" | "month" | "year";
  settings: CockpitBoardSettings;
  activeFilters: Set<string>;
  loadArchiveCardsForRange(from: string, to: string): Promise<CalendarCardData[]>;
  openCard(card: CardData | CalendarCardData): void;
  render(): Promise<void>;
}

export async function renderCalendarView(
  contentEl: HTMLElement,
  allCards: CardData[],
  ctx: CalendarViewContext,
): Promise<void> {
  const searchInput = contentEl.querySelector(".cockpit-search") as HTMLInputElement | null;
  const q = searchInput ? searchInput.value.toLowerCase() : "";

  const cards = allCards.filter(c => {
    if (!c.due) return false;
    if (q && !`${c.title} ${c.project} ${c.labels.join(" ")}`.toLowerCase().includes(q)) return false;
    if (ctx.activeFilters && ctx.activeFilters.size > 0) {
      if (![...ctx.activeFilters].some(f => c.labels.includes(f))) return false;
    }
    return true;
  });

  // Compute date range
  let rangeFrom: string;
  let rangeTo: string;
  const cd = ctx.calendarDate;
  if (ctx.calendarMode === "week") {
    const day = cd.getDay();
    const mon = new Date(cd);
    mon.setDate(cd.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    rangeFrom = mon.toISOString().split("T")[0];
    rangeTo = sun.toISOString().split("T")[0];
  } else if (ctx.calendarMode === "month") {
    rangeFrom = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}-01`;
    const last = new Date(cd.getFullYear(), cd.getMonth() + 1, 0);
    rangeTo = last.toISOString().split("T")[0];
  } else {
    rangeFrom = `${cd.getFullYear()}-01-01`;
    rangeTo = `${cd.getFullYear()}-12-31`;
  }

  const archiveCards = await ctx.loadArchiveCardsForRange(rangeFrom, rangeTo);
  const calCards: CalendarCardData[] = [
    ...cards.map(c => ({
      file: c.file,
      title: c.title,
      displayTitle: c.displayTitle,
      due: c.due,
      dueEnd: c.dueEnd,
      time: c.time,
      project: c.project,
      labels: c.labels,
      rawStatus: c.rawStatus,
      completed: c.completed,
      column: c.column,
    })),
    ...archiveCards,
  ];

  // Controls bar
  const controls = contentEl.createDiv({ cls: "cockpit-cal-controls" });

  for (const mode of ["week", "month", "year"] as const) {
    const btn = controls.createEl("button", {
      text: mode.charAt(0).toUpperCase() + mode.slice(1),
      cls: `cockpit-cal-mode-btn ${ctx.calendarMode === mode ? "active" : ""}`,
    });
    btn.addEventListener("click", () => { ctx.calendarMode = mode; ctx.render(); });
  }

  const prevBtn = controls.createEl("button", { text: "\u2190", cls: "cockpit-cal-nav-btn" });
  prevBtn.addEventListener("click", () => navigateCalendar(-1, ctx));

  const dateLabel = controls.createSpan({ cls: "cockpit-cal-date-label" });
  if (ctx.calendarMode === "week") {
    const d = new Date(ctx.calendarDate);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    dateLabel.textContent = `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (ctx.calendarMode === "month") {
    dateLabel.textContent = ctx.calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else {
    dateLabel.textContent = String(ctx.calendarDate.getFullYear());
  }

  const nextBtn = controls.createEl("button", { text: "\u2192", cls: "cockpit-cal-nav-btn" });
  nextBtn.addEventListener("click", () => navigateCalendar(1, ctx));

  const todayBtn = controls.createEl("button", { text: "Today", cls: "cockpit-cal-mode-btn" });
  todayBtn.addEventListener("click", () => { ctx.calendarDate = new Date(); ctx.render(); });

  const container = contentEl.createDiv();

  const openCard = (card: CalendarCardData) => ctx.openCard(card);
  const onDayClick = (date: Date) => {
    ctx.calendarDate = date;
    ctx.calendarMode = "week";
    ctx.render();
  };

  if (ctx.calendarMode === "week") {
    renderWeekView(container, calCards, ctx.calendarDate, ctx.settings, openCard);
  } else if (ctx.calendarMode === "month") {
    renderMonthView(container, calCards, ctx.calendarDate, ctx.settings, openCard, onDayClick);
  } else {
    renderYearView(container, calCards, ctx.calendarDate, ctx.settings, onDayClick);
  }
}

function navigateCalendar(delta: number, ctx: CalendarViewContext): void {
  if (ctx.calendarMode === "week") {
    ctx.calendarDate.setDate(ctx.calendarDate.getDate() + delta * 7);
  } else if (ctx.calendarMode === "month") {
    ctx.calendarDate.setMonth(ctx.calendarDate.getMonth() + delta);
  } else {
    ctx.calendarDate.setFullYear(ctx.calendarDate.getFullYear() + delta);
  }
  ctx.render();
}
