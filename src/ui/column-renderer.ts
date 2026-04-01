import { Menu } from "obsidian";
import type { CardData, ColumnConfig } from "../types";
import { parseDate } from "./dom-helpers";
import { createCard } from "./card-renderer";

export function createColumn(col: ColumnConfig, cards: CardData[], overdueCount: number, ctx: ColumnRendererContext): HTMLElement {
  const el = document.createElement("div");
  el.className = "cockpit-column";
  el.dataset.columnId = col.id;
  el.style.setProperty("--column-color", col.color);

  const isToday = col.rule === "date:today";

  // Build header with DOM API (no innerHTML)
  const headerEl = el.createDiv({ cls: "cockpit-column-header" });
  headerEl.createSpan({ cls: "cockpit-column-title", text: col.label });
  if (isToday && overdueCount > 0) {
    headerEl.createSpan({ cls: "cockpit-overdue-badge", text: `${overdueCount} overdue` });
  }
  headerEl.createSpan({ cls: "cockpit-column-count", text: String(cards.length) });

  const cardsEl = el.createDiv({ cls: "cockpit-column-cards" });
  const addBtn = el.createDiv({ cls: "cockpit-column-add", text: "+ Add a card" });

  // Column header right-click → sort options
  headerEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showColumnContextMenu(e, col, el, ctx);
  });

  // Week separators + alternating day shading for date:future columns
  if (col.rule === "date:future") {
    let currentWeek: string | null = null;
    let currentDay: string | null = null;
    let dayParity = 0;
    for (const card of cards) {
      if (card.due) {
        const due = parseDate(card.due);
        if (due) {
          const dayOfWeek = due.getDay() === 0 ? 6 : due.getDay() - 1;
          const mon = new Date(due);
          mon.setDate(mon.getDate() - dayOfWeek);
          const weekKey = `${mon.getFullYear()}-${mon.getMonth()}-${mon.getDate()}`;
          if (weekKey !== currentWeek) {
            currentWeek = weekKey;
            const sun = new Date(mon);
            sun.setDate(sun.getDate() + 6);
            const sep = document.createElement("div");
            sep.className = "cockpit-week-separator";
            sep.textContent = `${mon.toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${sun.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
            cardsEl.appendChild(sep);
          }
          const dayKey = card.due;
          if (dayKey !== currentDay) {
            currentDay = dayKey;
            dayParity = 1 - dayParity;
          }
        }
      }
      const cardEl = createCard(card, ctx);
      if (dayParity) cardEl.classList.add("cockpit-card-alt");
      cardsEl.appendChild(cardEl);
    }
  } else {
    for (const card of cards) cardsEl.appendChild(createCard(card, ctx));
  }

  // Add card button
  addBtn.addEventListener("click", () => {
    void (async () => {
      const title = await ctx.promptForTitle("New task");
      if (!title) return;
      await ctx.createCardInColumn(title, col);
    })();
  });

  // Drop zone — column level (desktop only)
  if (!ctx.isMobile) {
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("cockpit-column-dragover"); });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget as Node)) el.classList.remove("cockpit-column-dragover");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("cockpit-column-dragover");
      if (!ctx.draggedCard || !ctx.draggedEl) return;

      // Bulk drag
      if (ctx.selectedCards.size > 1 && ctx.selectedCards.has(ctx.draggedCard.file.path)) {
        void (async () => {
          ctx.pauseRefresh = true;
          ctx._bulkOperating = true;
          try {
            const count = ctx.selectedCards.size;
            for (const { card: selCard } of ctx.selectedCards.values()) {
              if (selCard.column !== col.id) await ctx.handleDrop(selCard, col);
            }
            ctx.toast(`Moved ${count} card(s) to ${col.label}`);
          } finally {
            ctx._bulkOperating = false;
            ctx.pauseRefresh = false;
            ctx.clearSelection();
            void ctx.render();
          }
        })();
        return;
      }

      const sourceColId = ctx.draggedCard.column;
      cardsEl.appendChild(ctx.draggedEl);
      if (sourceColId === col.id) {
        void ctx.persistColumnOrder(col.id);
      } else {
        void (async () => {
          await ctx.handleDrop(ctx.draggedCard!, col);
          await ctx.persistColumnOrder(col.id);
        })();
      }
    });
  }

  return el;
}

function showColumnContextMenu(e: MouseEvent, col: ColumnConfig, el: HTMLElement, ctx: ColumnRendererContext): void {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle("Sort by title A\u2192Z").setIcon("arrow-down-az")
    .onClick(() => { void ctx.sortColumn(col.id, (a: CardData, b: CardData) => a.displayTitle.localeCompare(b.displayTitle)); }));
  menu.addItem((i) => i.setTitle("Sort by title Z\u2192A").setIcon("arrow-up-az")
    .onClick(() => { void ctx.sortColumn(col.id, (a: CardData, b: CardData) => b.displayTitle.localeCompare(a.displayTitle)); }));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Sort by date (earliest)").setIcon("arrow-up")
    .onClick(() => { void ctx.sortColumn(col.id, (a: CardData, b: CardData) => (a.due || "9").localeCompare(b.due || "9")); }));
  menu.addItem((i) => i.setTitle("Sort by date (latest)").setIcon("arrow-down")
    .onClick(() => { void ctx.sortColumn(col.id, (a: CardData, b: CardData) => (b.due || "").localeCompare(a.due || "")); }));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Clear custom order").setIcon("rotate-ccw")
    .onClick(() => { void ctx.clearColumnOrder(col.id); }));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Select all cards").setIcon("check-square")
    .onClick(() => {
      const cardEls = Array.from(el.querySelectorAll(".cockpit-card[data-path]"));
      for (const cardEl of cardEls) {
        const htmlEl = cardEl as HTMLElement;
        const path = htmlEl.dataset.path;
        if (path && !ctx.selectedCards.has(path)) {
          const cardData = ctx.allCards?.find(c => c.file.path === path);
          if (cardData) {
            ctx.selectedCards.set(path, { card: cardData, el: htmlEl });
            htmlEl.classList.add("cockpit-card-selected");
          }
        }
      }
      ctx.updateSelectionBar();
    }));
  menu.showAtMouseEvent(e);
}

// Extended context for column renderer
import type { CardRendererContext } from "./card-renderer";

export interface ColumnRendererContext extends CardRendererContext {
  promptForTitle(heading: string): Promise<string | null>;
  createCardInColumn(title: string, col: ColumnConfig): Promise<void>;
  sortColumn(colId: string, sortFn: (a: CardData, b: CardData) => number): Promise<void>;
  clearColumnOrder(colId: string): Promise<void>;
  updateSelectionBar(): void;
}
