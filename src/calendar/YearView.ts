import type { CalendarCardData, CockpitBoardSettings } from "../types";
import { todayStr, getLabelColor } from "../ui/dom-helpers";

let yearTooltipEl: HTMLElement | null = null;

function showYearTooltip(
  e: MouseEvent,
  tasks: CalendarCardData[],
  highlightIdx: number,
  date: Date,
): void {
  hideYearTooltip();
  const tip = document.createElement("div");
  tip.className = "cockpit-cal-year-tooltip";
  const title = tip.createDiv({ cls: "cockpit-cal-year-tooltip-title" });
  title.textContent = `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} \u2014 ${tasks.length} task(s)`;
  for (let i = 0; i < Math.min(tasks.length, 10); i++) {
    const t = tasks[i];
    const item = tip.createDiv({
      cls: `cockpit-cal-year-tooltip-item ${i === highlightIdx ? "cockpit-cal-year-tooltip-item-highlight" : ""}`,
    });
    item.textContent = `\u2022 ${t.time ? t.time + " " : ""}${t.displayTitle}`;
  }
  if (tasks.length > 10) {
    tip.createDiv({ cls: "cockpit-cal-year-tooltip-item", text: `... +${tasks.length - 10} more` });
  }
  document.body.appendChild(tip);
  const rect = (e.target as HTMLElement).getBoundingClientRect();
  tip.style.left = `${rect.right + 8}px`;
  tip.style.top = `${rect.top}px`;
  const tipRect = tip.getBoundingClientRect();
  if (tipRect.right > window.innerWidth) tip.style.left = `${rect.left - tipRect.width - 8}px`;
  if (tipRect.bottom > window.innerHeight) tip.style.top = `${window.innerHeight - tipRect.height - 8}px`;
  yearTooltipEl = tip;
}

export function hideYearTooltip(): void {
  if (yearTooltipEl) { yearTooltipEl.remove(); yearTooltipEl = null; }
}

export function renderYearView(
  container: HTMLElement,
  cards: CalendarCardData[],
  calendarDate: Date,
  settings: CockpitBoardSettings,
  onDayClick: (date: Date) => void,
): void {
  const year = calendarDate.getFullYear();
  const grid = container.createDiv({ cls: "cockpit-cal-year" });
  const today = todayStr();

  for (let m = 0; m < 12; m++) {
    const monthBlock = grid.createDiv({ cls: "cockpit-cal-year-month" });
    monthBlock.createDiv({
      cls: "cockpit-cal-year-month-name",
      text: new Date(year, m).toLocaleString("en-US", { month: "short" }),
    });
    const days = monthBlock.createDiv({ cls: "cockpit-cal-year-days" });
    const daysInMonth = new Date(year, m + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = dateStr === today;
      const dayEl = days.createDiv({ cls: `cockpit-cal-year-day ${isToday ? "cockpit-cal-today" : ""}` });

      const dayTasks = cards.filter(c => {
        if (!c.due) return false;
        if (c.dueEnd) return c.due <= dateStr && c.dueEnd >= dateStr;
        return c.due === dateStr;
      });

      if (dayTasks.length > 0) {
        const tooltipDate = new Date(year, m, d);
        for (let ti = 0; ti < Math.min(dayTasks.length, 4); ti++) {
          const task = dayTasks[ti];
          const dot = dayEl.createDiv({ cls: "cockpit-cal-year-dot" });
          const color = task.labels.length > 0 ? getLabelColor(task.labels[0], settings) : "#45B7D1";
          dot.style.backgroundColor = color;
          dot.title = `${task.time ? task.time + " " : ""}${task.displayTitle}`;
          dot.addEventListener("mouseenter", (e) => {
            dot.classList.add("cockpit-cal-year-dot-hover");
            showYearTooltip(e, dayTasks, ti, tooltipDate);
          });
          dot.addEventListener("mouseleave", () => {
            dot.classList.remove("cockpit-cal-year-dot-hover");
            hideYearTooltip();
          });
        }
        if (dayTasks.length > 4) {
          const more = dayEl.createDiv({ cls: "cockpit-cal-year-dot-more" });
          more.textContent = `+${dayTasks.length - 4}`;
        }

        dayEl.addEventListener("mouseenter", (e) => {
          if (dayTasks.length > 0 && !(e.target as HTMLElement).classList.contains("cockpit-cal-year-dot")) {
            showYearTooltip(e, dayTasks, -1, tooltipDate);
          }
        });
        dayEl.addEventListener("mouseleave", () => hideYearTooltip());
      }

      dayEl.addEventListener("click", () => onDayClick(new Date(year, m, d)));
    }
  }
}
