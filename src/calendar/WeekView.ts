import type { CalendarCardData, CockpitBoardSettings } from "../types";
import { todayStr, getLabelColor } from "../ui/dom-helpers";

export function renderWeekView(
  container: HTMLElement,
  cards: CalendarCardData[],
  calendarDate: Date,
  settings: CockpitBoardSettings,
  openCard: (card: CalendarCardData) => void,
): void {
  const d = new Date(calendarDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const today = todayStr();

  const allDayRow = container.createDiv({ cls: "cockpit-cal-allday" });
  allDayRow.createDiv({ cls: "cockpit-cal-time-gutter" });

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cellDate = new Date(monday);
    cellDate.setDate(monday.getDate() + i);
    const dateStr = cellDate.toISOString().split("T")[0];
    dates.push(dateStr);
    const isToday = dateStr === today;

    const headerCell = allDayRow.createDiv({ cls: `cockpit-cal-allday-col ${isToday ? "cockpit-cal-today" : ""}` });
    headerCell.createDiv({
      cls: "cockpit-cal-day-header",
      text: cellDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
    });

    const dayCards = cards.filter(c => {
      if (!c.due) return false;
      const match = c.dueEnd ? (c.due <= dateStr && c.dueEnd >= dateStr) : (c.due === dateStr);
      return match && !c.time;
    });
    for (const card of dayCards) {
      const cardEl = headerCell.createDiv({ cls: "cockpit-cal-card" });
      if (card.labels.length > 0) {
        cardEl.style.borderLeft = `3px solid ${getLabelColor(card.labels[0], settings)}`;
      }
      cardEl.createSpan({ text: card.displayTitle, cls: "cockpit-cal-card-text" });
      cardEl.addEventListener("click", () => openCard(card));
    }
  }

  const timeGrid = container.createDiv({ cls: "cockpit-cal-timegrid" });
  for (let hour = 7; hour <= 22; hour++) {
    const row = timeGrid.createDiv({ cls: "cockpit-cal-timerow" });
    const label = row.createDiv({ cls: "cockpit-cal-time-gutter" });
    label.textContent = `${hour}:00`;

    for (let i = 0; i < 7; i++) {
      const dateStr = dates[i];
      const isToday = dateStr === today;
      const cell = row.createDiv({ cls: `cockpit-cal-timecell ${isToday ? "cockpit-cal-today-bg" : ""}` });

      const hourCards = cards.filter(c => {
        if (!c.due || !c.time) return false;
        const match = c.dueEnd ? (c.due <= dateStr && c.dueEnd >= dateStr) : (c.due === dateStr);
        if (!match) return false;
        const [h] = c.time.split(":").map(Number);
        return h === hour;
      });

      for (const card of hourCards) {
        const cardEl = cell.createDiv({ cls: "cockpit-cal-timecard" });
        if (card.labels.length > 0) {
          cardEl.style.borderLeft = `3px solid ${getLabelColor(card.labels[0], settings)}`;
        }
        cardEl.textContent = `${card.time} ${card.displayTitle}`;
        cardEl.title = `${card.displayTitle}\n${card.time}${card.project ? `\nProject: ${card.project}` : ""}${card.labels.length ? `\nLabels: ${card.labels.join(", ")}` : ""}`;
        cardEl.addEventListener("click", (e) => { e.stopPropagation(); openCard(card); });
      }
    }
  }
}
