import { Menu } from "obsidian";
import type { CardData, ColumnConfig, CockpitBoardSettings } from "../types";
import { todayStr, getToday, getTomorrow, getLabelColor } from "./dom-helpers";

export interface SelectionContext {
  containerEl: HTMLElement;
  selectedCards: Map<string, { card: CardData; el: HTMLElement }>;
  lastSelectedCard: { card: CardData; el: HTMLElement } | null;
  allCards: CardData[] | null;
  columns: ColumnConfig[];
  settings: CockpitBoardSettings;
  pauseRefresh: boolean;
  _bulkOperating: boolean;
  handleDrop(card: CardData, col: ColumnConfig): Promise<void>;
  updateCardProperty(file: unknown, props: Record<string, unknown>): Promise<void>;
  toast(msg: string): void;
  render(): Promise<void>;
  promptDateTime(card: CardData): void;
  app: {
    vault: { trash(file: unknown, system: boolean): Promise<void> };
    fileManager: { processFrontMatter(file: unknown, fn: (fm: Record<string, unknown>) => void): Promise<void> };
  };
}

export function toggleSelectCard(card: CardData, el: HTMLElement, ctx: SelectionContext): void {
  if (ctx.selectedCards.has(card.file.path)) {
    ctx.selectedCards.delete(card.file.path);
    el.classList.remove("cockpit-card-selected");
  } else {
    ctx.selectedCards.set(card.file.path, { card, el });
    el.classList.add("cockpit-card-selected");
    ctx.lastSelectedCard = { card, el };
  }
  updateSelectionBar(ctx);
}

export function selectRange(card: CardData, el: HTMLElement, ctx: SelectionContext): void {
  if (!ctx.lastSelectedCard) return;
  const colEl = el.closest(".cockpit-column");
  if (!colEl) return;
  const allCards = Array.from(colEl.querySelectorAll(".cockpit-card[data-path]"));
  const lastIdx = allCards.indexOf(ctx.lastSelectedCard.el);
  const thisIdx = allCards.indexOf(el);
  if (lastIdx === -1 || thisIdx === -1) return;
  const [from, to] = lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
  for (let i = from; i <= to; i++) {
    const cardEl = allCards[i] as HTMLElement;
    const path = cardEl.dataset.path;
    if (path && !ctx.selectedCards.has(path)) {
      const cardData = ctx.allCards?.find(c => c.file.path === path);
      if (cardData) {
        ctx.selectedCards.set(path, { card: cardData, el: cardEl });
        cardEl.classList.add("cockpit-card-selected");
      }
    }
  }
  updateSelectionBar(ctx);
}

export function clearSelection(ctx: SelectionContext): void {
  for (const { el } of ctx.selectedCards.values()) {
    el.classList.remove("cockpit-card-selected");
  }
  ctx.selectedCards.clear();
  ctx.lastSelectedCard = null;
  updateSelectionBar(ctx);
}

export function updateSelectionBar(ctx: SelectionContext): void {
  let bar = ctx.containerEl.querySelector(".cockpit-selection-bar") as HTMLElement | null;
  if (ctx.selectedCards.size === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "cockpit-selection-bar";
    ctx.containerEl.appendChild(bar);
  }
  // Clear bar using DOM API (no innerHTML)
  bar.empty();
  bar.createSpan({ text: `${ctx.selectedCards.size} card(s) selected`, cls: "cockpit-selection-count" });

  for (const col of ctx.columns) {
    const btn = bar.createEl("button", { text: col.label, cls: "cockpit-selection-btn" });
    btn.style.borderColor = col.color;
    btn.addEventListener("click", () => bulkMoveTo(col, ctx));
  }

  bar.createEl("span", { text: "|", cls: "cockpit-selection-sep" });

  const addLabelBtn = bar.createEl("button", { text: "+ Label", cls: "cockpit-selection-btn" });
  addLabelBtn.addEventListener("click", (e) => {
    const menu = new Menu();
    const allLabels = collectLabels(ctx);
    for (const label of allLabels) {
      menu.addItem((i) => i.setTitle(label).onClick(() => bulkAddLabel(label, ctx)));
    }
    menu.showAtMouseEvent(e);
  });

  const rmLabelBtn = bar.createEl("button", { text: "- Label", cls: "cockpit-selection-btn" });
  rmLabelBtn.addEventListener("click", (e) => {
    const menu = new Menu();
    const selectedLabels = new Set<string>();
    for (const { card } of ctx.selectedCards.values()) card.labels.forEach(l => selectedLabels.add(l));
    for (const label of selectedLabels) {
      menu.addItem((i) => i.setTitle(label).onClick(() => bulkRemoveLabel(label, ctx)));
    }
    menu.showAtMouseEvent(e);
  });

  const clearDatesBtn = bar.createEl("button", { text: "Clear dates", cls: "cockpit-selection-btn" });
  clearDatesBtn.addEventListener("click", () => bulkClearDueDate(ctx));

  const doneBtn = bar.createEl("button", { text: "\u2713 Done", cls: "cockpit-selection-btn cockpit-selection-done" });
  doneBtn.addEventListener("click", () => bulkMarkDone(ctx));

  const delBtn = bar.createEl("button", { text: "Delete", cls: "cockpit-selection-btn cockpit-selection-delete" });
  delBtn.addEventListener("click", () => bulkDelete(ctx));

  const clearBtn = bar.createEl("button", { text: "\u2715", cls: "cockpit-selection-btn" });
  clearBtn.addEventListener("click", () => clearSelection(ctx));
}

export function showBulkMenu(e: MouseEvent, ctx: SelectionContext): void {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(`${ctx.selectedCards.size} cards selected`).setDisabled(true));
  menu.addSeparator();
  for (const col of ctx.columns) {
    menu.addItem((i) => i.setTitle(`Move all to ${col.label}`).setIcon("arrow-right")
      .onClick(() => bulkMoveTo(col, ctx)));
  }
  menu.addSeparator();
  const allLabels = collectLabels(ctx);
  for (const label of allLabels) {
    menu.addItem((i) => i.setTitle(`+ ${label}`).setIcon("tag")
      .onClick(() => bulkAddLabel(label, ctx)));
  }
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Set date & time...").setIcon("calendar-clock").onClick(() => bulkSetDateTime(ctx)));
  menu.addItem((i) => i.setTitle("Set due tomorrow").setIcon("calendar-plus")
    .onClick(() => bulkSetDate(getTomorrow().toISOString().split("T")[0], ctx)));
  menu.addItem((i) => i.setTitle("Set due next week").setIcon("calendar-range")
    .onClick(() => {
      const d = getToday();
      d.setDate(d.getDate() + (8 - d.getDay()) % 7 || 7);
      bulkSetDate(d.toISOString().split("T")[0], ctx);
    }));
  menu.addItem((i) => i.setTitle("Clear due dates").setIcon("calendar-x").onClick(() => bulkClearDueDate(ctx)));
  menu.addSeparator();
  const selectedLabels = new Set<string>();
  for (const { card } of ctx.selectedCards.values()) card.labels.forEach(l => selectedLabels.add(l));
  if (selectedLabels.size > 0) {
    for (const label of selectedLabels) {
      menu.addItem((i) => i.setTitle(`- ${label}`).setIcon("x").onClick(() => bulkRemoveLabel(label, ctx)));
    }
    menu.addSeparator();
  }
  menu.addItem((i) => i.setTitle("Mark all as Done").setIcon("check").onClick(() => bulkMarkDone(ctx)));
  menu.addItem((i) => i.setTitle("Delete all").setIcon("trash").setWarning(true).onClick(() => bulkDelete(ctx)));
  menu.showAtMouseEvent(e);
}

function collectLabels(ctx: SelectionContext): string[] {
  const labels = new Set<string>();
  if (ctx.allCards) {
    for (const c of ctx.allCards) c.labels.forEach(l => labels.add(l));
  }
  for (const l of Object.keys(ctx.settings.labelColors)) labels.add(l);
  return Array.from(labels);
}

async function bulkMoveTo(col: ColumnConfig, ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  ctx._bulkOperating = true;
  try {
    const count = ctx.selectedCards.size;
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.handleDrop(card, col);
    }
    ctx.toast(`Moved ${count} card(s) to ${col.label}`);
  } finally {
    ctx._bulkOperating = false;
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

async function bulkAddLabel(label: string, ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
        const labels = Array.isArray(fm.labels) ? fm.labels : [];
        if (!(labels as string[]).includes(label)) fm.labels = [...labels as string[], label];
      });
    }
  } finally {
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

async function bulkRemoveLabel(label: string, ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
        fm.labels = (Array.isArray(fm.labels) ? fm.labels : []).filter((l: unknown) => l !== label);
      });
    }
  } finally {
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

async function bulkSetDate(dateStr: string, ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  ctx._bulkOperating = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.updateCardProperty(card.file, { due: dateStr, status: "scheduled" });
    }
    ctx.toast(`Date set to ${dateStr} on ${ctx.selectedCards.size} card(s)`);
  } finally {
    ctx._bulkOperating = false;
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

function bulkSetDateTime(ctx: SelectionContext): void {
  // Delegated to the view's promptDateTime for bulk
  // The view will handle this via its own modal
  const firstCard = ctx.selectedCards.values().next().value;
  if (firstCard) ctx.promptDateTime(firstCard.card);
}

async function bulkClearDueDate(ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.updateCardProperty(card.file, { due: "", time: "" });
    }
    ctx.toast(`Cleared dates on ${ctx.selectedCards.size} card(s)`);
  } finally {
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

async function bulkMarkDone(ctx: SelectionContext): Promise<void> {
  ctx.pauseRefresh = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
        fm.status = "done";
        fm.completed = todayStr();
      });
    }
  } finally {
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}

async function bulkDelete(ctx: SelectionContext): Promise<void> {
  if (!confirm(`Delete ${ctx.selectedCards.size} card(s)?`)) return;
  ctx.pauseRefresh = true;
  try {
    for (const { card } of ctx.selectedCards.values()) {
      await ctx.app.vault.trash(card.file, true);
    }
  } finally {
    ctx.pauseRefresh = false;
    clearSelection(ctx);
    ctx.render();
  }
}
