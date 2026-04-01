import { Menu } from "obsidian";
import { ConfirmModal } from "./confirm-modal";
import type { CardData, ColumnConfig, CockpitBoardSettings, TimerData } from "../types";
import { getToday, getTomorrow, datePillClass, formatDueDisplay, getLabelColor } from "./dom-helpers";

export interface CardRendererContext {
  settings: CockpitBoardSettings;
  columns: ColumnConfig[];
  isMobile: boolean;
  activeTimers: Map<string, TimerData>;
  selectedCards: Map<string, { card: CardData; el: HTMLElement }>;
  lastSelectedCard: { card: CardData; el: HTMLElement } | null;
  allCards: CardData[] | null;
  draggedCard: CardData | null;
  draggedEl: HTMLElement | null;
  pauseRefresh: boolean;
  _bulkOperating: boolean;
  openCard(card: CardData): void;
  openChecklistEditor(card: CardData): void;
  promptDateTime(card: CardData): void;
  toggleSelectCard(card: CardData, el: HTMLElement): void;
  selectRange(card: CardData, el: HTMLElement): void;
  clearSelection(): void;
  showBulkMenu(e: MouseEvent): void;
  handleDrop(card: CardData, col: ColumnConfig, neighbor?: CardData): Promise<void>;
  persistColumnOrder(colId: string): Promise<void>;
  updateCardProperty(file: unknown, props: Record<string, unknown>): Promise<void>;
  duplicateCard(card: CardData): Promise<void>;
  splitAndCloseCard(card: CardData): Promise<void>;
  toast(msg: string): void;
  render(): Promise<void>;
  startPomodoro(cardPath: string): void;
  stopPomodoro(): void;
  isPomodoroActive(cardPath: string): boolean;
  getPomodoroTimeRemaining(): string;
  app: {
    workspace: { getLeaf(type: string): { openFile(file: unknown): Promise<void> } };
    fileManager: {
      processFrontMatter(file: unknown, fn: (fm: Record<string, unknown>) => void): Promise<void>;
      trashFile(file: unknown): Promise<void>;
    };
  };
}

export function createCard(card: CardData, ctx: CardRendererContext): HTMLElement {
  const el = createDiv();
  el.className = "cockpit-card";
  el.draggable = !ctx.isMobile;
  el.dataset.path = card.file.path;
  el.dataset.labels = card.labels.join(",");

  // Card background tint by primary label
  if (ctx.settings.cardLabelTint && card.labels.length > 0) {
    const color = getLabelColor(card.labels[0], ctx.settings);
    el.style.setProperty("--card-tint", color + "18");
  }

  // Determine if we should hide date (Today column — only show time)
  const isInToday = card.column === "today" || ctx.columns.find(c => c.id === card.column)?.rule === "date:today";

  if (card.labels.length > 0) {
    const labelsEl = createDiv();
    labelsEl.className = "cockpit-card-labels";
    for (const label of card.labels) {
      const bar = createSpan();
      bar.className = "cockpit-label";
      bar.style.backgroundColor = getLabelColor(label, ctx.settings);
      bar.title = label;
      labelsEl.appendChild(bar);
    }
    el.appendChild(labelsEl);
  }

  const titleEl = createDiv();
  titleEl.className = "cockpit-card-title";
  if (ctx.settings.privacyMode) {
    titleEl.classList.add("cockpit-privacy-blur");
    titleEl.addEventListener("mouseenter", () => titleEl.classList.remove("cockpit-privacy-blur"));
    titleEl.addEventListener("mouseleave", () => titleEl.classList.add("cockpit-privacy-blur"));
  }
  titleEl.textContent = card.displayTitle;
  el.appendChild(titleEl);

  // Build meta DOM (no innerHTML)
  const metaEl = buildCardMeta(card, ctx, isInToday);
  if (metaEl) el.appendChild(metaEl);

  // Click — Ctrl+Click to select, Shift+Click for range, normal click opens
  el.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      ctx.toggleSelectCard(card, el);
      return;
    }
    if (e.shiftKey && ctx.lastSelectedCard) {
      e.preventDefault();
      ctx.selectRange(card, el);
      return;
    }
    if (ctx.selectedCards.size > 0) {
      ctx.clearSelection();
      return;
    }
    ctx.openCard(card);
  });

  // Right-click context menu
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (ctx.selectedCards.size > 1 && ctx.selectedCards.has(card.file.path)) {
      ctx.showBulkMenu(e);
      return;
    }
    showCardContextMenu(e, card, ctx);
  });

  // Mobile: long-press triggers context menu
  if (ctx.isMobile) {
    attachLongPress(el);
  }

  // Drag + drop (desktop only)
  if (!ctx.isMobile) {
    attachDragHandlers(el, card, ctx);
  }

  return el;
}

function buildCardMeta(card: CardData, ctx: CardRendererContext, isInToday: boolean): HTMLElement | null {
  const metaEl = createDiv();
  metaEl.className = "cockpit-card-meta";
  let hasContent = false;

  // Date pill
  const pillClass = datePillClass(card.due);
  if (isInToday) {
    if (card.time) {
      const span = createSpan();
      span.className = "cockpit-date cockpit-date-soon cockpit-date-clickable";
      span.textContent = `\u25F7 ${card.time}`;
      span.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); ctx.promptDateTime(card); });
      metaEl.appendChild(span);
      hasContent = true;
    }
  } else {
    const dateDisplay = formatDueDisplay(card.due, card.time, card.dueEnd);
    if (dateDisplay && pillClass) {
      const span = createSpan();
      span.className = `cockpit-date ${pillClass} cockpit-date-clickable`;
      span.textContent = `\u25F7 ${dateDisplay}`;
      span.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); ctx.promptDateTime(card); });
      metaEl.appendChild(span);
      hasContent = true;
    }
  }

  // Description indicator
  if (card.hasDesc) {
    const descSpan = createSpan();
    descSpan.className = "cockpit-meta-icon";
    descSpan.textContent = "\u2261";
    metaEl.appendChild(descSpan);
    hasContent = true;
  }

  // Checklist count
  if (card.totalChecks > 0) {
    const clSpan = createSpan();
    clSpan.className = "cockpit-meta-icon";
    clSpan.textContent = `\u2611 ${card.checkedCount}/${card.totalChecks}`;
    if (ctx.settings.checklistEditor) {
      clSpan.classList.add("cockpit-cl-trigger");
      clSpan.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.openChecklistEditor(card);
      });
    }
    metaEl.appendChild(clSpan);
    hasContent = true;
  }

  // Timer display
  const isTimerRunning = ctx.activeTimers.has(card.file.path);
  if (isTimerRunning) {
    const timer = ctx.activeTimers.get(card.file.path)!;
    const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
    const h = Math.floor(elapsed / 60);
    const m = elapsed % 60;
    const timerSpan = createSpan();
    timerSpan.className = "cockpit-timer-display cockpit-timer-active";
    timerSpan.textContent = h > 0 ? `\u25B6 ${h}h${m}m` : `\u25B6 ${m}m`;
    metaEl.appendChild(timerSpan);
    hasContent = true;
  } else if (card.timeSpent > 0) {
    const h = Math.floor(card.timeSpent / 60);
    const m = card.timeSpent % 60;
    const timerSpan = createSpan();
    timerSpan.className = "cockpit-timer-display";
    timerSpan.textContent = `\u23F1 ${h > 0 ? `${h}h${m}m` : `${m}m`}`;
    metaEl.appendChild(timerSpan);
    hasContent = true;
  }

  // Pomodoro display
  if (ctx.settings.pomodoroEnabled) {
    const isPomActive = ctx.isPomodoroActive(card.file.path);
    if (isPomActive) {
      const pomSpan = createSpan();
      pomSpan.className = "cockpit-timer-display cockpit-timer-active cockpit-pomodoro-display";
      pomSpan.textContent = `\uD83C\uDF45 ${ctx.getPomodoroTimeRemaining()}`;
      metaEl.appendChild(pomSpan);
      hasContent = true;
    } else if (card.pomodoros > 0) {
      const pomSpan = createSpan();
      pomSpan.className = "cockpit-meta-icon cockpit-pomodoro-count";
      pomSpan.textContent = `\uD83C\uDF45 ${card.pomodoros}`;
      pomSpan.title = `${card.pomodoros} pomodoro(s) completed`;
      metaEl.appendChild(pomSpan);
      hasContent = true;
    }
  }

  // Recurring indicator
  if (card.source === "recurring") {
    const recurSpan = createSpan();
    recurSpan.className = "cockpit-meta-icon cockpit-recurring";
    recurSpan.title = "Recurring task";
    recurSpan.textContent = "\uD83D\uDD04";
    metaEl.appendChild(recurSpan);
    hasContent = true;
  }

  return hasContent ? metaEl : null;
}

function showCardContextMenu(e: MouseEvent, card: CardData, ctx: CardRendererContext): void {
  const menu = new Menu();

  menu.addItem((i) => i.setTitle("Open in new tab").setIcon("file-text")
    .onClick(() => { void ctx.app.workspace.getLeaf("tab").openFile(card.file); }));
  menu.addSeparator();

  for (const col of ctx.columns) {
    if (col.id === card.column) continue;
    menu.addItem((i) => i.setTitle(`Move to ${col.label}`).setIcon("arrow-right")
      .onClick(() => { void ctx.handleDrop(card, col); }));
  }
  menu.addSeparator();

  // Collect all unique labels from cards for the submenu
  const allLabels = new Set<string>();
  if (ctx.allCards) {
    for (const c of ctx.allCards) c.labels.forEach(l => allLabels.add(l));
  }
  // Also add configured label colors
  for (const l of Object.keys(ctx.settings.labelColors)) allLabels.add(l);

  for (const label of allLabels) {
    if (card.labels.includes(label)) continue;
    menu.addItem((i) => i.setTitle(`+ ${label}`).setIcon("tag")
      .onClick(() => {
        void ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
          const labels = Array.isArray(fm.labels) ? fm.labels : [];
          fm.labels = [...labels as string[], label];
        });
      }));
  }
  if (card.labels.length > 0) {
    menu.addSeparator();
    for (const label of card.labels) {
      menu.addItem((i) => i.setTitle(`- ${label}`).setIcon("x")
        .onClick(() => {
          void ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
            fm.labels = (Array.isArray(fm.labels) ? fm.labels : []).filter((l: unknown) => l !== label);
          });
        }));
    }
  }
  menu.addSeparator();

  if (card.due) {
    menu.addItem((i) => i.setTitle("Clear due date").setIcon("calendar-x")
      .onClick(() => { void ctx.updateCardProperty(card.file, { due: "", time: "" }); }));
  }
  if (card.time) {
    menu.addItem((i) => i.setTitle("Clear time").setIcon("clock")
      .onClick(() => { void ctx.updateCardProperty(card.file, { time: "" }); }));
  }
  menu.addItem((i) => i.setTitle("Set due tomorrow").setIcon("calendar-plus")
    .onClick(() => { void ctx.updateCardProperty(card.file, { status: "scheduled", due: getTomorrow().toISOString().split("T")[0] }); }));
  menu.addItem((i) => i.setTitle("Set due next week").setIcon("calendar-range")
    .onClick(() => {
      const d = getToday();
      d.setDate(d.getDate() + (8 - d.getDay()) % 7 || 7);
      void ctx.updateCardProperty(card.file, { status: "scheduled", due: d.toISOString().split("T")[0] });
    }));
  menu.addItem((i) => i.setTitle("Set date & time...").setIcon("calendar-clock")
    .onClick(() => ctx.promptDateTime(card)));

  menu.addSeparator();
  const isRunning = ctx.activeTimers.has(card.file.path);
  if (!isRunning) {
    menu.addItem((i) => i.setTitle("Start timer").setIcon("play")
      .onClick(() => {
        ctx.activeTimers.set(card.file.path, { startTime: Date.now(), previousMinutes: card.timeSpent || 0 });
        ctx.toast("Timer started");
        void ctx.render();
      }));
  } else {
    menu.addItem((i) => i.setTitle("Stop timer").setIcon("square")
      .onClick(() => {
        void (async () => {
          const timer = ctx.activeTimers.get(card.file.path)!;
          const elapsed = Math.floor((Date.now() - timer.startTime) / 60000) + timer.previousMinutes;
          ctx.activeTimers.delete(card.file.path);
          await ctx.updateCardProperty(card.file, { time_spent: elapsed });
          ctx.toast(`Timer stopped: ${elapsed}m`);
        })();
      }));
  }
  if (card.timeSpent > 0 || isRunning) {
    menu.addItem((i) => i.setTitle("Reset timer").setIcon("rotate-ccw")
      .onClick(() => {
        void (async () => {
          ctx.activeTimers.delete(card.file.path);
          await ctx.updateCardProperty(card.file, { time_spent: 0 });
          ctx.toast("Timer reset");
        })();
      }));
  }

  // Pomodoro menu items
  if (ctx.settings.pomodoroEnabled) {
    menu.addSeparator();
    const isPomActive = ctx.isPomodoroActive(card.file.path);
    if (!isPomActive) {
      menu.addItem((i) => i.setTitle("Start pomodoro").setIcon("timer")
        .onClick(() => {
          ctx.startPomodoro(card.file.path);
          void ctx.render();
        }));
    } else {
      menu.addItem((i) => i.setTitle("Stop pomodoro").setIcon("square")
        .onClick(() => {
          ctx.stopPomodoro();
          void ctx.render();
        }));
    }
    if (card.pomodoros > 0) {
      menu.addItem((i) => i.setTitle("Reset pomodoro count").setIcon("rotate-ccw")
        .onClick(() => { void ctx.updateCardProperty(card.file, { pomodoros: 0 }); }));
    }
  }

  menu.addSeparator();
  menu.addItem((i) => i.setTitle("Duplicate card").setIcon("copy")
    .onClick(() => { void ctx.duplicateCard(card); }));
  if (card.totalChecks > 0 && card.checkedCount > 0 && card.checkedCount < card.totalChecks) {
    menu.addItem((i) => i.setTitle("Split and close").setIcon("scissors")
      .onClick(() => { void ctx.splitAndCloseCard(card); }));
  }
  menu.addItem((i) => i.setTitle("Delete card").setIcon("trash").setWarning(true)
    .onClick(() => {
      new ConfirmModal(ctx.app as unknown as import("obsidian").App, `Delete "${card.displayTitle}"?`, () => {
        void ctx.app.fileManager.trashFile(card.file);
      }).open();
    }));

  menu.showAtMouseEvent(e);
}

function attachLongPress(el: HTMLElement): void {
  let lpTimer: ReturnType<typeof setTimeout> | null = null;
  let lpMoved = false;
  el.addEventListener("touchstart", (e) => {
    lpMoved = false;
    const touch = e.touches[0];
    lpTimer = setTimeout(() => {
      if (lpMoved) return;
      el.dispatchEvent(new MouseEvent("contextmenu", { clientX: touch.clientX, clientY: touch.clientY, bubbles: true }));
    }, 500);
  }, { passive: true });
  el.addEventListener("touchmove", () => {
    lpMoved = true;
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  }, { passive: true });
  el.addEventListener("touchend", () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  }, { passive: true });
}

function attachDragHandlers(el: HTMLElement, card: CardData, ctx: CardRendererContext): void {
  el.addEventListener("dragstart", (e) => {
    ctx.draggedCard = card;
    ctx.draggedEl = el;
    e.dataTransfer?.setData("text/plain", card.file.path);
    el.classList.add("cockpit-card-dragging");
  });
  el.addEventListener("dragend", () => {
    ctx.draggedCard = null;
    ctx.draggedEl = null;
    el.classList.remove("cockpit-card-dragging");
    document.querySelectorAll(".cockpit-column-dragover, .cockpit-card-dropzone").forEach(c =>
      c.classList.remove("cockpit-column-dragover", "cockpit-card-dropzone")
    );
  });

  if (ctx.settings.enableCustomOrder) {
    el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("cockpit-card-dropzone"); });
    el.addEventListener("dragleave", () => el.classList.remove("cockpit-card-dropzone"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("cockpit-card-dropzone");
      if (!ctx.draggedEl || ctx.draggedEl === el) return;

      // Bulk drag
      if (ctx.selectedCards.size > 1 && ctx.selectedCards.has(ctx.draggedCard?.file?.path || "")) {
        const targetColId = el.closest(".cockpit-column")?.getAttribute("data-column-id");
        const targetCol = ctx.columns.find(c => c.id === targetColId);
        if (targetCol) {
          void (async () => {
            ctx.pauseRefresh = true;
            ctx._bulkOperating = true;
            try {
              const count = ctx.selectedCards.size;
              for (const { card: selCard } of ctx.selectedCards.values()) {
                if (selCard.column !== targetCol.id) await ctx.handleDrop(selCard, targetCol, card);
              }
              ctx.toast(`Moved ${count} card(s) to ${targetCol.label}`);
            } finally {
              ctx._bulkOperating = false;
              ctx.pauseRefresh = false;
              ctx.clearSelection();
              void ctx.render();
            }
          })();
        }
        return;
      }

      const targetColId = el.closest(".cockpit-column")?.getAttribute("data-column-id");
      const sourceColId = ctx.draggedCard?.column;
      const targetCol = ctx.columns.find(c => c.id === targetColId);

      el.parentNode?.insertBefore(ctx.draggedEl, el);

      if (sourceColId === targetColId) {
        void ctx.persistColumnOrder(targetColId!);
      } else if (targetCol) {
        void (async () => {
          await ctx.handleDrop(ctx.draggedCard!, targetCol, card);
          await ctx.persistColumnOrder(targetColId!);
        })();
      }
    });
  }
}
