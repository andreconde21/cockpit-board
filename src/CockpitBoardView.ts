import {
  ItemView, WorkspaceLeaf, TFile, TFolder, Menu, Modal,
  MarkdownRenderer, Notice, Platform, setIcon,
} from "obsidian";
import { ConfirmModal } from "./ui/confirm-modal";
import type { CardData, ColumnConfig, CalendarCardData, CockpitBoardSettings } from "./types";
import { VIEW_TYPE } from "./constants";
import { CockpitCard } from "./CockpitCard";
import { getDropUpdates } from "./rule-engine";
import { todayStr, getToday, getTomorrow, parseDate, formatDateLocal } from "./ui/dom-helpers";
import { type CardRendererContext } from "./ui/card-renderer";
import { createColumn, type ColumnRendererContext } from "./ui/column-renderer";
import {
  toggleSelectCard, selectRange, clearSelection,
  updateSelectionBar, showBulkMenu, type SelectionContext,
} from "./ui/selection-manager";
import { ChecklistEditorModal } from "./ui/checklist-editor";
import { DateTimePickerModal } from "./ui/date-time-picker";
import { renderCalendarView, hideYearTooltip, type CalendarViewContext } from "./calendar/CalendarView";
import { renderArchiveSearch, loadArchiveCardsForRange, type ArchiveContext } from "./archive/ArchiveSearch";
import type CockpitBoardPlugin from "./CockpitBoardPlugin";

export class CockpitBoardView extends ItemView {
  plugin: CockpitBoardPlugin;
  draggedCard: CardData | null = null;
  draggedEl: HTMLElement | null = null;
  refreshTimer: ReturnType<typeof setTimeout> | null = null;
  focusMode = false;
  selectedCards = new Map<string, { card: CardData; el: HTMLElement }>();
  lastSelectedCard: { card: CardData; el: HTMLElement } | null = null;
  isMobile: boolean;
  activeColumnIndex = 0;
  showArchive = false;
  showCalendar = false;
  calendarMode: "week" | "month" | "year" = "week";
  calendarDate = new Date();
  allCards: CardData[] | null = null;
  activeFilters: Set<string> = new Set();
  pauseRefresh = false;
  _bulkOperating = false;
  ctrlHeld = false;
  private _archiveSearchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CockpitBoardPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.isMobile = Platform?.isMobile || false;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Cockpit board"; }
  getIcon(): string { return "layout-grid"; }

  get columns(): ColumnConfig[] { return this.plugin.settings.columns; }
  get settings(): CockpitBoardSettings { return this.plugin.settings; }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("cockpit-board-container");
    await this.render();
    this.registerEvent(this.app.vault.on("create", () => this.debouncedRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.debouncedRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.debouncedRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.debouncedRefresh()));

    // Track Ctrl key state for Ctrl+drag date override
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Control") {
        this.ctrlHeld = true;
        this.showCtrlBar();
      }
    });
    this.registerDomEvent(document, "keyup", (e: KeyboardEvent) => {
      if (e.key === "Control") {
        this.ctrlHeld = false;
        this.hideCtrlBar();
      }
    });
    // Reset on window blur — but NOT during drag (drag can cause brief blur)
    this.registerDomEvent(window, "blur", () => {
      // Delay reset to avoid false reset during drag-and-drop
      setTimeout(() => {
        if (!document.hasFocus()) {
          this.ctrlHeld = false;
          this.hideCtrlBar();
        }
      }, 100);
    });

    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "Escape") { this.clearSelection(); return; }
      if (e.key === "f" || e.key === "F") {
        if (this.selectedCards.size === 0) {
          e.preventDefault();
          this.focusMode = !this.focusMode;
          void this.render();
          this.toast(this.focusMode ? "Focus mode: Today + In Progress" : "Focus mode off");
          return;
        }
      }
      if (this.selectedCards.size === 0) return;
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        void this.bulkMarkDone();
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        this.pauseRefresh = true;
        void (async () => {
          for (const { card } of this.selectedCards.values()) {
            await this.updateCardProperty(card.file, { status: "scheduled", due: todayStr() });
          }
          this.pauseRefresh = false;
          this.clearSelection();
          void this.render();
        })();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.bulkDelete();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void this.promptForTitle("New task").then(title => { if (title) void this.createCardInColumn(title, this.columns[0]); });
      }
    });
  }

  onClose(): Promise<void> {
    hideYearTooltip();
    return Promise.resolve();
  }

  debouncedRefresh(): void {
    if (this.pauseRefresh) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { void this.render(); }, 500);
  }

  async loadCards(): Promise<CardData[]> {
    if (!this.settings.folder) return [];
    const folder = this.app.vault.getAbstractFileByPath(this.settings.folder);
    if (!folder || !(folder instanceof TFolder)) return [];
    const raw: { file: TFile; fm: Record<string, unknown> }[] = [];
    const walk = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === "md") {
          const cache = this.app.metadataCache.getFileCache(child);
          raw.push({ file: child, fm: cache?.frontmatter || {} });
        } else if (child instanceof TFolder) walk(child);
      }
    };
    walk(folder);

    const cards: CardData[] = [];
    for (const { file, fm } of raw) {
      const content = await this.app.vault.cachedRead(file);
      cards.push(new CockpitCard(file, fm, content, this.columns));
    }
    cards.sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.displayTitle.localeCompare(b.displayTitle);
    });
    return cards;
  }

  groupByColumn(cards: CardData[]): Map<string, CardData[]> {
    const groups = new Map<string, CardData[]>();
    for (const col of this.columns) groups.set(col.id, []);
    for (const card of cards) {
      if (!groups.has(card.column)) groups.set(card.column, []);
      groups.get(card.column)!.push(card);
    }

    const useOrder = this.settings.enableCustomOrder;

    for (const col of this.columns) {
      const arr = groups.get(col.id);
      if (!arr) continue;
      const isDone = col.rule?.includes("status:done");
      const isDateColumn = col.rule === "date:future" || col.rule === "date:today" || col.rule === "date:tomorrow";

      if (isDateColumn) {
        arr.sort((a, b) => {
          const dateComp = (a.due || "9").localeCompare(b.due || "9");
          if (dateComp !== 0) return dateComp;
          if (useOrder) {
            if (a.order != null && b.order != null) return a.order - b.order;
            if (a.order != null) return -1;
            if (b.order != null) return 1;
          }
          return a.displayTitle.localeCompare(b.displayTitle);
        });
      } else if (useOrder) {
        arr.sort((a, b) => {
          if (a.order != null && b.order != null) return a.order - b.order;
          if (a.order != null) return -1;
          if (b.order != null) return 1;
          if (isDone) return (b.completed || "").localeCompare(a.completed || "");
          if (a.due && b.due) return a.due.localeCompare(b.due);
          if (a.due) return -1;
          if (b.due) return 1;
          return a.displayTitle.localeCompare(b.displayTitle);
        });
      } else if (isDone) {
        arr.sort((a, b) => (b.completed || "").localeCompare(a.completed || ""));
      }
    }
    return groups;
  }

  toast(msg: string): void { new Notice(msg, 2500); }

  async render(): Promise<void> {
    const contentEl = this.containerEl.children[1] as HTMLElement;
    const scrollPositions: Record<string, number> = {};
    contentEl.querySelectorAll(".cockpit-column-cards").forEach(col => {
      const colId = (col.closest(".cockpit-column") as HTMLElement)?.dataset?.columnId;
      if (colId) scrollPositions[colId] = (col as HTMLElement).scrollTop;
    });
    const boardScrollLeft = (contentEl.querySelector(".cockpit-board") as HTMLElement)?.scrollLeft || 0;

    contentEl.empty();
    contentEl.addClass("cockpit-board-content");

    // First-run: show setup prompt if folder not configured
    if (!this.settings.folder) {
      const welcome = contentEl.createDiv({ cls: "cockpit-welcome" });
      welcome.createEl("h2", { text: "Welcome to cockpit board!" });
      welcome.createEl("p", { text: "Set your tasks folder in settings to get started." });
      welcome.createEl("p", { text: "Go to settings \u2192 cockpit board \u2192 tasks folder" });
      return;
    }

    const cards = await this.loadCards();
    this.allCards = cards;
    const groups = this.groupByColumn(cards);

    // Header
    const header = contentEl.createDiv({ cls: "cockpit-board-header" });
    header.createEl("h2", { text: "Cockpit board" });

    const searchWrap = header.createDiv({ cls: "cockpit-search-wrap" });
    const searchInput = searchWrap.createEl("input", { type: "text", placeholder: "Search cards...", cls: "cockpit-search" });

    // Label filter dropdown — collect labels from actual cards
    const filterBtn = searchWrap.createEl("button", { cls: "cockpit-filter-dropdown-btn" });
    filterBtn.textContent = this.activeFilters.size > 0 ? `Labels (${this.activeFilters.size})` : "Labels";
    if (this.activeFilters.size > 0) filterBtn.classList.add("cockpit-filter-has-active");
    filterBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      const allLabels = this.collectAllLabels(cards);
      for (const label of allLabels) {
        const active = this.activeFilters.has(label);
        menu.addItem((i) => i.setTitle(`${active ? "\u2713 " : "  "}${label}`)
          .onClick(() => {
            if (active) this.activeFilters.delete(label);
            else this.activeFilters.add(label);
            this.applyFilters(contentEl);
            filterBtn.textContent = this.activeFilters.size > 0 ? `Labels (${this.activeFilters.size})` : "Labels";
            filterBtn.classList.toggle("cockpit-filter-has-active", this.activeFilters.size > 0);
          }));
      }
      if (this.activeFilters.size > 0) {
        menu.addSeparator();
        menu.addItem((i) => i.setTitle("Clear all filters").onClick(() => {
          this.activeFilters.clear();
          this.applyFilters(contentEl);
          filterBtn.textContent = "Labels";
          filterBtn.classList.remove("cockpit-filter-has-active");
        }));
      }
      menu.showAtMouseEvent(e);
    });

    searchInput.addEventListener("input", () => this.applyFilters(contentEl));

    // Archive toggle
    if (this.settings.archiveFolder) {
      const archiveBtn = header.createEl("button", {
        cls: `clickable-icon cockpit-archive-btn ${this.showArchive ? "cockpit-archive-active" : ""}`,
        attr: { "aria-label": "Archive" },
      });
      archiveBtn.textContent = this.showArchive ? "\uD83D\uDCCB Board" : "\uD83D\uDCCB Archive";
      archiveBtn.addEventListener("click", () => {
        this.showArchive = !this.showArchive;
        this.showCalendar = false;
        void this.render();
      });
    }

    // Calendar toggle
    const calBtn = header.createEl("button", {
      cls: `clickable-icon cockpit-archive-btn ${this.showCalendar ? "cockpit-archive-active" : ""}`,
      attr: { "aria-label": "Calendar" },
    });
    calBtn.textContent = this.showCalendar ? "\uD83D\uDCC5 Board" : "\uD83D\uDCC5 Calendar";
    calBtn.addEventListener("click", () => {
      this.showCalendar = !this.showCalendar;
      this.showArchive = false;
      void this.render();
    });

    // Refresh button — using Obsidian setIcon (no innerHTML)
    const refreshBtn = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh" } });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => { void this.render(); });

    // Focus mode toggle
    const focusBtn = header.createEl("button", {
      cls: `clickable-icon cockpit-focus-btn ${this.focusMode ? "cockpit-focus-active" : ""}`,
      attr: { "aria-label": "Focus mode" },
    });
    focusBtn.textContent = this.focusMode ? "\uD83D\uDC41 Focus" : "\u25CE Focus";
    focusBtn.addEventListener("click", () => {
      this.focusMode = !this.focusMode;
      void this.render();
      this.toast(this.focusMode ? "Focus mode: Today + In Progress" : "Focus mode off");
    });

    if (this.showArchive) {
      renderArchiveSearch(contentEl, this.getArchiveContext());
      return;
    }

    if (this.showCalendar) {
      await renderCalendarView(contentEl, cards, this.getCalendarContext());
      return;
    }

    const overdueCount = cards.filter(c => c.column !== "done" && c.due && parseDate(c.due)! < getToday()).length;

    if (this.isMobile) {
      this.renderMobile(contentEl, groups, overdueCount);
    } else {
      const focusCols = new Set(["today", "in-progress"]);
      const board = contentEl.createDiv({ cls: `cockpit-board ${this.focusMode ? "cockpit-board-focus" : ""}` });
      const ctx = this.getColumnRendererContext();
      for (const col of this.columns) {
        if (this.focusMode && !focusCols.has(col.id)) continue;
        board.appendChild(createColumn(col, groups.get(col.id) || [], overdueCount, ctx));
      }
      const addColBtn = board.createDiv({ cls: "cockpit-add-column" });
      addColBtn.textContent = "+ add list";
      addColBtn.addEventListener("click", async () => {
        const name = await this.promptForTitle("New list name");
        if (!name) return;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
        this.plugin.settings.columns.push({ id, label: name, color: "#778CA3", rule: null });
        await this.plugin.saveSettings();
        void this.render();
      });
    }

    setTimeout(() => {
      const board = contentEl.querySelector(".cockpit-board");
      if (board) board.scrollLeft = boardScrollLeft;
      contentEl.querySelectorAll(".cockpit-column-cards").forEach(col => {
        const colId = (col.closest(".cockpit-column") as HTMLElement)?.dataset?.columnId;
        if (colId && scrollPositions[colId]) (col as HTMLElement).scrollTop = scrollPositions[colId];
      });
    }, 50);
  }

  // ── Mobile rendering ──
  private renderMobile(contentEl: HTMLElement, groups: Map<string, CardData[]>, overdueCount: number): void {
    if (this.activeColumnIndex === 0 && this.settings.mobileDefaultColumn) {
      const defIdx = this.columns.findIndex(c => c.id === this.settings.mobileDefaultColumn);
      if (defIdx >= 0) this.activeColumnIndex = defIdx;
    }

    const tabs = contentEl.createDiv({ cls: "cockpit-mobile-tabs" });
    this.columns.forEach((col, idx) => {
      const count = (groups.get(col.id) || []).length;
      const tab = tabs.createDiv({ cls: "cockpit-mobile-tab" });
      tab.style.setProperty("--column-color", col.color);
      // Build tab content with DOM API (no innerHTML)
      tab.createSpan({ text: col.label });
      tab.createSpan({ text: String(count), cls: "cockpit-mobile-tab-count" });
      if (idx === this.activeColumnIndex) tab.classList.add("cockpit-mobile-tab-active");
      tab.addEventListener("click", () => {
        this.activeColumnIndex = idx;
        this.renderMobileColumn(area, groups, overdueCount);
        tabs.querySelectorAll(".cockpit-mobile-tab").forEach((t, i) => {
          t.classList.toggle("cockpit-mobile-tab-active", i === idx);
        });
        tab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      });
    });

    setTimeout(() => {
      const activeTab = tabs.children[this.activeColumnIndex] as HTMLElement;
      if (activeTab) activeTab.scrollIntoView({ inline: "center", block: "nearest" });
    }, 50);

    const area = contentEl.createDiv({ cls: "cockpit-mobile-column-area" });
    this.renderMobileColumn(area, groups, overdueCount);

    // Swipe gesture — fixed touchend bug: use callback parameter
    let startX = 0, startY = 0, isDragging = false;
    area.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = false;
    }, { passive: true });
    area.addEventListener("touchmove", (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!isDragging && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 2) isDragging = true;
    }, { passive: true });
    area.addEventListener("touchend", (e) => {
      if (!isDragging) return;
      const dx = startX - (e.changedTouches?.[0]?.clientX || startX);
      if (dx > 50) {
        this.activeColumnIndex = Math.min(this.columns.length - 1, this.activeColumnIndex + 1);
      } else if (dx < -50) {
        this.activeColumnIndex = Math.max(0, this.activeColumnIndex - 1);
      } else return;
      this.renderMobileColumn(area, groups, overdueCount);
      tabs.querySelectorAll(".cockpit-mobile-tab").forEach((t, i) => {
        t.classList.toggle("cockpit-mobile-tab-active", i === this.activeColumnIndex);
      });
      const activeTab = tabs.children[this.activeColumnIndex] as HTMLElement;
      if (activeTab) activeTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  }

  private renderMobileColumn(area: HTMLElement, groups: Map<string, CardData[]>, overdueCount: number): void {
    area.empty();
    const col = this.columns[this.activeColumnIndex];
    if (!col) return;
    const ctx = this.getColumnRendererContext();
    const colEl = createColumn(col, groups.get(col.id) || [], overdueCount, ctx);
    area.appendChild(colEl);
  }

  // ── Ctrl+drag indicator ──
  private _ctrlBar: HTMLElement | null = null;

  private showCtrlBar(): void {
    if (this._ctrlBar) return;
    this._ctrlBar = this.containerEl.createDiv({ cls: "cockpit-ctrl-bar" });
    this._ctrlBar.textContent = "\u2328 Ctrl held \u2014 click to multi-select \u00b7 drop will override date to match column";
  }

  private hideCtrlBar(): void {
    if (this._ctrlBar) {
      this._ctrlBar.remove();
      this._ctrlBar = null;
    }
  }

  // ── Filtering ──
  private collectAllLabels(cards: CardData[]): string[] {
    const labels = new Set<string>();
    for (const c of cards) c.labels.forEach(l => labels.add(l));
    for (const l of Object.keys(this.settings.labelColors)) labels.add(l);
    return Array.from(labels).sort();
  }

  applyFilters(contentEl: HTMLElement): void {
    const searchInput = contentEl.querySelector<HTMLInputElement>(".cockpit-search");
    const q = searchInput ? searchInput.value.toLowerCase() : "";
    Array.from(contentEl.querySelectorAll(".cockpit-card")).forEach(c => {
      const el = c as HTMLElement;
      const textMatch = !q || (el.textContent || "").toLowerCase().includes(q);
      const labelMatch = this.activeFilters.size === 0 || [...this.activeFilters].some(f => (el.dataset.labels || "").includes(f));
      el.classList.toggle("cockpit-card-hidden", !(textMatch && labelMatch));
    });
  }

  // ── Selection delegates ──
  toggleSelectCard(card: CardData, el: HTMLElement): void { toggleSelectCard(card, el, this.getSelectionContext()); }
  selectRange(card: CardData, el: HTMLElement): void { selectRange(card, el, this.getSelectionContext()); }
  clearSelection(): void { clearSelection(this.getSelectionContext()); }
  updateSelectionBar(): void { updateSelectionBar(this.getSelectionContext()); }
  showBulkMenu(e: MouseEvent): void { showBulkMenu(e, this.getSelectionContext()); }

  // ── Actions ──
  async handleDrop(card: CardData, targetCol: ColumnConfig, neighborCard?: CardData, forceDate = false): Promise<void> {
    if (card.column === targetCol.id) return;
    const updates = getDropUpdates(targetCol, card, this.settings, forceDate);

    // When Ctrl+drag to Scheduled and card has no date, infer from neighbor/column
    const isDateCol = targetCol.rule === "date:future" || targetCol.rule === "date:today" || targetCol.rule === "date:tomorrow";
    if (forceDate && isDateCol && !("due" in updates) && !card.due) {
      if (neighborCard?.due) {
        updates.due = neighborCard.due;
      } else {
        const colCards = (this.allCards || []).filter(c => c.column === targetCol.id && c.due);
        if (colCards.length > 0) {
          colCards.sort((a, b) => a.due.localeCompare(b.due));
          updates.due = colCards[0].due;
        } else if (targetCol.rule === "date:today") {
          updates.due = todayStr();
        } else {
          updates.due = formatDateLocal(getTomorrow());
        }
      }
    }

    try {
      const content = await this.app.vault.read(card.file);
      const newContent = this.applyFrontmatterUpdates(content, updates);
      await this.app.vault.modify(card.file, newContent);
      // Wait for metadata cache to pick up the file change
      await new Promise(r => setTimeout(r, 200));
      if (!this._bulkOperating) {
        this.toast(`Moved to ${targetCol.label || targetCol.id}`);
        void this.render();
      }
    } catch (e: unknown) {
      console.error("Cockpit Board:", e);
      new Notice("Error moving card");
    }
  }

  private applyFrontmatterUpdates(content: string, updates: Record<string, string>): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;
    let fm = fmMatch[1];
    const body = content.slice(fmMatch[0].length);

    const setField = (field: string, value: string) => {
      const regex = new RegExp(`^${field}:.*$`, "m");
      if (regex.test(fm)) {
        fm = fm.replace(regex, `${field}: ${value}`);
      } else {
        fm += `\n${field}: ${value}`;
      }
    };

    if ("status" in updates) setField("status", updates.status);
    if ("due" in updates) setField("due", updates.due);
    if ("time" in updates) setField("time", updates.time);
    if ("completed" in updates) setField("completed", updates.completed);
    setField("order", "0");

    if (updates._addLabel) {
      const labelsMatch = fm.match(/^labels:\s*\[(.*)\]$/m);
      if (labelsMatch) {
        const existing = labelsMatch[1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
        if (!existing.includes(updates._addLabel)) {
          existing.push(updates._addLabel);
          fm = fm.replace(/^labels:.*$/m, `labels: [${existing.map(l => `"${l}"`).join(", ")}]`);
        }
      }
    }
    if (updates._removeLabel) {
      const labelsMatch = fm.match(/^labels:\s*\[(.*)\]$/m);
      if (labelsMatch) {
        const existing = labelsMatch[1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
        const filtered = existing.filter(l => l !== updates._removeLabel);
        fm = fm.replace(/^labels:.*$/m, `labels: [${filtered.map(l => `"${l}"`).join(", ")}]`);
      }
    }

    return `---\n${fm}\n---${body}`;
  }

  async persistColumnOrder(colId: string): Promise<void> {
    this.pauseRefresh = true;
    try {
      // Delay to let Obsidian's file cache catch up after vault.modify writes
      await new Promise(r => setTimeout(r, 300));
      const colEl = this.containerEl.querySelector(`.cockpit-column[data-column-id="${colId}"]`);
      if (!colEl) return;
      const cardEls = Array.from(colEl.querySelectorAll(".cockpit-card[data-path]"));
      let order = 1;
      for (const cardEl of cardEls) {
        const path = (cardEl as HTMLElement).dataset.path;
        const file = this.app.vault.getAbstractFileByPath(path || "");
        if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.order = order; });
          order++;
        }
      }
    } finally {
      setTimeout(() => { this.pauseRefresh = false; }, 2000);
    }
  }

  async sortColumn(colId: string, sortFn: (a: CardData, b: CardData) => number): Promise<void> {
    this.pauseRefresh = true;
    try {
      const cards = (await this.loadCards()).filter(c => c.column === colId);
      cards.sort(sortFn);
      let order = 1;
      for (const card of cards) {
        await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => { fm.order = order; });
        order++;
      }
    } finally {
      this.pauseRefresh = false;
      void this.render();
    }
  }

  async clearColumnOrder(colId: string): Promise<void> {
    this.pauseRefresh = true;
    try {
      const cards = (await this.loadCards()).filter(c => c.column === colId);
      for (const card of cards) {
        if (card.order != null) {
          await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => { delete fm.order; });
        }
      }
    } finally {
      this.pauseRefresh = false;
      void this.render();
    }
  }

  async openCard(card: CardData | CalendarCardData): Promise<void> {
    const mode = this.settings.cardOpenMode || "split";
    const file = card.file;
    if (mode === "sidebar") {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.openFile(file);
        void this.app.workspace.revealLeaf(leaf);
      }
    } else if (mode === "modal") {
      const modal = new Modal(this.app);
      modal.titleEl.setText(card.displayTitle);
      modal.modalEl.addClass("cockpit-card-modal");
      const content = await this.app.vault.read(file);
      const container = modal.contentEl.createDiv({ cls: "cockpit-card-modal-content" });
      await MarkdownRenderer.render(this.app, content, container, file.path, this);
      const editBtn = modal.contentEl.createEl("button", { text: "Open in editor", cls: "mod-cta cockpit-card-modal-edit" });
      editBtn.addEventListener("click", () => {
        modal.close();
        void this.app.workspace.getLeaf("tab").openFile(file);
      });
      modal.open();
    } else {
      void this.app.workspace.getLeaf("split").openFile(file);
    }
  }

  openChecklistEditor(card: CardData): void {
    new ChecklistEditorModal(this.app, card, () => { void this.render(); }).open();
  }

  promptDateTime(card: CardData): void {
    new DateTimePickerModal(
      this.app, card,
      (file, props) => this.updateCardProperty(file, props),
      () => {},
    ).open();
  }

  async updateCardProperty(file: unknown, props: Record<string, unknown>): Promise<void> {
    try {
      if (!(file instanceof TFile)) return;
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(props)) fm[k] = v;
      });
    } catch { new Notice("Error updating card"); }
  }

  async duplicateCard(card: CardData): Promise<void> {
    try {
      const content = await this.app.vault.read(card.file);
      const base = card.file.path.replace(/\.md$/, "");
      let path = base + "-copy.md";
      let i = 2;
      while (this.app.vault.getAbstractFileByPath(path)) { path = base + `-copy-${i}.md`; i++; }
      const newFile = await this.app.vault.create(path, content);
      // Reset status/completed but preserve everything else (labels, project, etc.)
      await this.app.fileManager.processFrontMatter(newFile, (fm: Record<string, unknown>) => {
        fm.status = "scheduled";
        fm.completed = "";
        delete fm.order;
      });
    } catch { new Notice("Error duplicating card"); }
  }

  async splitAndCloseCard(card: CardData): Promise<void> {
    try {
      const content = await this.app.vault.read(card.file);
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = fmMatch ? fmMatch[0] : "";
      const body = fmMatch ? content.slice(fmMatch[0].length) : content;

      const bodyLines = body.split("\n");
      const newBodyLines: string[] = [];
      let i = 0;
      while (i < bodyLines.length) {
        if (bodyLines[i].match(/^## Checklist/)) {
          const heading = bodyLines[i];
          const sectionLines: string[] = [];
          let hasUnchecked = false;
          let j = i + 1;
          while (j < bodyLines.length && !bodyLines[j].match(/^## /)) {
            if (bodyLines[j].match(/^- \[ \] /)) {
              hasUnchecked = true;
              sectionLines.push(bodyLines[j]);
            } else if (!bodyLines[j].match(/^- \[x\] /i)) {
              sectionLines.push(bodyLines[j]);
            }
            j++;
          }
          if (hasUnchecked) {
            newBodyLines.push(heading);
            newBodyLines.push(...sectionLines);
          }
          i = j;
        } else {
          if (!bodyLines[i].match(/^- \[x\] /i)) newBodyLines.push(bodyLines[i]);
          i++;
        }
      }

      // Mark original as done
      await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => {
        fm.status = "done";
        fm.completed = todayStr();
        fm.order = 0;
      });

      // Create continuation with original frontmatter + unchecked items
      const origContent = await this.app.vault.read(card.file);
      const origFmMatch = origContent.match(/^---\n([\s\S]*?)\n---/);
      const origFmBlock = origFmMatch ? origFmMatch[0] : frontmatter;
      const newContent = origFmBlock + "\n" + newBodyLines.join("\n");
      const base = card.file.path.replace(/\.md$/, "");
      let path = base + "-cont.md";
      let n = 2;
      while (this.app.vault.getAbstractFileByPath(path)) { path = base + `-cont-${n}.md`; n++; }
      const newFile = await this.app.vault.create(path, newContent);
      // Reset status/completed but keep labels, project, etc.
      await this.app.fileManager.processFrontMatter(newFile, (fm: Record<string, unknown>) => {
        fm.status = "pending";
        fm.completed = "";
        delete fm.order;
      });
      this.toast("Split: original \u2192 Done, new card with remaining items");
    } catch (e: unknown) {
      console.error("Cockpit Board:", e);
      new Notice("Error splitting card");
    }
  }

  promptForTitle(heading = "New task"): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(heading);
      const input = modal.contentEl.createEl("input", { type: "text", placeholder: "Title...", cls: "cockpit-new-task-input" });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { modal.close(); resolve(input.value.trim()); }
        if (e.key === "Escape") { modal.close(); resolve(null); }
      });
      modal.onOpen = () => input.focus();
      modal.onClose = () => { if (!input.value.trim()) resolve(null); };
      modal.open();
    });
  }

  async createCardInColumn(title: string, col: ColumnConfig): Promise<void> {
    const updates = getDropUpdates(col, { due: "", labels: [] } as unknown as CardData);
    const status = updates.status || "";
    const due = updates.due || "";
    const labels = updates._addLabel ? `["${updates._addLabel}"]` : "[]";

    const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
    let path = `${this.settings.folder}/${slug}.md`;
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(path)) { path = `${this.settings.folder}/${slug}-${i}.md`; i++; }

    await this.app.vault.create(path, `---\ntitle: "${title.replace(/"/g, '\\"')}"\nstatus: ${status}\ndue: ${due}\ntime:\ncompleted:\nproject:\nlabels: ${labels}\ncreated: ${todayStr()}\nsource: manual\n---\n\n# ${title}\n`);
  }

  private async bulkMarkDone(): Promise<void> {
    this.pauseRefresh = true;
    try {
      for (const { card } of this.selectedCards.values()) {
        await this.app.fileManager.processFrontMatter(card.file, (fm: Record<string, unknown>) => {
          fm.status = "done";
          fm.completed = todayStr();
        });
      }
    } finally {
      this.pauseRefresh = false;
      this.clearSelection();
      void this.render();
    }
  }

  private bulkDelete(): void {
    new ConfirmModal(this.app, `Delete ${this.selectedCards.size} card(s)?`, () => {
      void (async () => {
        this.pauseRefresh = true;
        try {
          for (const { card } of this.selectedCards.values()) {
            await this.app.fileManager.trashFile(card.file);
          }
        } finally {
          this.pauseRefresh = false;
          this.clearSelection();
          void this.render();
        }
      })();
    }).open();
  }

  // ── Context builders ──
  private getColumnRendererContext(): ColumnRendererContext {
    return {
      settings: this.settings,
      columns: this.columns,
      isMobile: this.isMobile,
      activeTimers: this.plugin.activeTimers,
      selectedCards: this.selectedCards,
      lastSelectedCard: this.lastSelectedCard,
      allCards: this.allCards,
      draggedCard: this.draggedCard,
      draggedEl: this.draggedEl,
      pauseRefresh: this.pauseRefresh,
      _bulkOperating: this._bulkOperating,
      openCard: (card: CardData) => this.openCard(card),
      openChecklistEditor: (card: CardData) => this.openChecklistEditor(card),
      promptDateTime: (card: CardData) => this.promptDateTime(card),
      toggleSelectCard: (card: CardData, el: HTMLElement) => this.toggleSelectCard(card, el),
      selectRange: (card: CardData, el: HTMLElement) => this.selectRange(card, el),
      clearSelection: () => this.clearSelection(),
      showBulkMenu: (e: MouseEvent) => this.showBulkMenu(e),
      handleDrop: (card: CardData, col: ColumnConfig, neighbor?: CardData, forceDate?: boolean) => this.handleDrop(card, col, neighbor, forceDate),
      isCtrlHeld: () => this.ctrlHeld,
      persistColumnOrder: (colId: string) => this.persistColumnOrder(colId),
      updateCardProperty: (file: unknown, props: Record<string, unknown>) => this.updateCardProperty(file, props),
      duplicateCard: (card: CardData) => this.duplicateCard(card),
      splitAndCloseCard: (card: CardData) => this.splitAndCloseCard(card),
      toast: (msg: string) => this.toast(msg),
      render: () => this.render(),
      startPomodoro: (cardPath: string) => this.plugin.startPomodoro(cardPath),
      stopPomodoro: () => this.plugin.stopPomodoro(),
      isPomodoroActive: (cardPath: string) => this.plugin.pomodoro.isActiveFor(cardPath),
      getPomodoroTimeRemaining: () => this.plugin.pomodoro.formatTimeRemaining(),
      app: this.app as CardRendererContext["app"],
      promptForTitle: (heading: string) => this.promptForTitle(heading),
      createCardInColumn: (title: string, col: ColumnConfig) => this.createCardInColumn(title, col),
      sortColumn: (colId: string, sortFn: (a: CardData, b: CardData) => number) => this.sortColumn(colId, sortFn),
      clearColumnOrder: (colId: string) => this.clearColumnOrder(colId),
      updateSelectionBar: () => this.updateSelectionBar(),
    };
  }

  private getSelectionContext(): SelectionContext {
    return {
      containerEl: this.containerEl,
      selectedCards: this.selectedCards,
      lastSelectedCard: this.lastSelectedCard,
      allCards: this.allCards,
      columns: this.columns,
      settings: this.settings,
      pauseRefresh: this.pauseRefresh,
      _bulkOperating: this._bulkOperating,
      handleDrop: (card, col) => this.handleDrop(card, col),
      updateCardProperty: (file, props) => this.updateCardProperty(file, props),
      toast: (msg) => this.toast(msg),
      render: () => this.render(),
      promptDateTime: (card) => this.promptDateTime(card),
      app: this.app as SelectionContext["app"],
    };
  }

  private getCalendarContext(): CalendarViewContext {
    return {
      calendarDate: this.calendarDate,
      calendarMode: this.calendarMode,
      settings: this.settings,
      activeFilters: this.activeFilters,
      loadArchiveCardsForRange: (from, to) => Promise.resolve(loadArchiveCardsForRange(from, to, this.getArchiveContext())),
      openCard: (card) => this.openCard(card),
      render: () => this.render(),
    };
  }

  private getArchiveContext(): ArchiveContext {
    return {
      settings: this.settings,
      app: this.app as ArchiveContext["app"],
      openCard: (card) => this.openCard(card as CardData),
    };
  }
}
