import type { CalendarCardData, CockpitBoardSettings } from "../types";
import { todayStr, getLabelColor } from "../ui/dom-helpers";

export function renderMonthView(
  container: HTMLElement,
  cards: CalendarCardData[],
  calendarDate: Date,
  settings: CockpitBoardSettings,
  openCard: (card: CalendarCardData) => void,
  onDayClick: (date: Date) => void,
): void {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = new Date(year, month, 1).getDay() === 0 ? 6 : new Date(year, month, 1).getDay() - 1;
  const today = todayStr();

  const grid = container.createDiv({ cls: "cockpit-cal-month" });

  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach(d => {
    grid.createDiv({ cls: "cockpit-cal-month-header", text: d });
  });

  for (let i = 0; i < startOffset; i++) {
    grid.createDiv({ cls: "cockpit-cal-month-cell cockpit-cal-month-empty" });
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isToday = dateStr === today;
    const cell = grid.createDiv({ cls: `cockpit-cal-month-cell ${isToday ? "cockpit-cal-today" : ""}` });
    cell.createDiv({ cls: "cockpit-cal-month-day", text: String(day) });

    const dayCards = cards.filter(c => {
      if (!c.due) return false;
      if (c.dueEnd) return c.due <= dateStr && c.dueEnd >= dateStr;
      return c.due === dateStr;
    });

    if (dayCards.length > 0) {
      const list = cell.createDiv({ cls: "cockpit-cal-month-cards" });
      for (const card of dayCards.slice(0, 3)) {
        const item = list.createDiv({ cls: "cockpit-cal-month-card" });
        if (card.labels.length > 0) {
          item.style.borderLeft = `3px solid ${getLabelColor(card.labels[0], settings)}`;
        }
        item.textContent = card.time ? `${card.time} ${card.title}` : card.title;
        item.addEventListener("click", (e) => { e.stopPropagation(); openCard(card); });
      }
      if (dayCards.length > 3) {
        list.createDiv({ cls: "cockpit-cal-month-more", text: `+${dayCards.length - 3} more` });
      }
    }

    cell.addEventListener("click", () => onDayClick(new Date(year, month, day)));
  }
}
