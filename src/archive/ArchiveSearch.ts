import { TFile, TFolder } from "obsidian";
import type { ArchiveResult, CalendarCardData, CockpitBoardSettings } from "../types";
import { fmStr } from "../ui/dom-helpers.js";

export interface ArchiveContext {
  settings: CockpitBoardSettings;
  app: {
    vault: { getAbstractFileByPath(path: string): unknown };
    metadataCache: { getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null };
  };
  openCard(card: { file: TFile; displayTitle: string }): void;
}

export function renderArchiveSearch(contentEl: HTMLElement, ctx: ArchiveContext): void {
  if (!ctx.settings.archiveFolder) {
    contentEl.createDiv({ cls: "cockpit-archive-empty", text: "Configure an archive folder in Settings to use Archive Search." });
    return;
  }

  const container = contentEl.createDiv({ cls: "cockpit-archive-container" });
  const controls = container.createDiv({ cls: "cockpit-archive-controls" });

  const fromInput = controls.createEl("input", { type: "date", cls: "cockpit-archive-date" });
  const toInput = controls.createEl("input", { type: "date", cls: "cockpit-archive-date" });

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  fromInput.value = weekAgo.toISOString().split("T")[0];
  toInput.value = today.toISOString().split("T")[0];

  const quickBtns = controls.createDiv({ cls: "cockpit-archive-quick" });
  const quickFilters = [
    { label: "Today", from: 0, to: 0 },
    { label: "Yesterday", from: 1, to: 1 },
    { label: "This Week", from: today.getDay() === 0 ? 6 : today.getDay() - 1, to: 0 },
    { label: "This Month", from: today.getDate() - 1, to: 0 },
    { label: "Last Month", from: -1, to: -1 },
  ];
  for (const qf of quickFilters) {
    const btn = quickBtns.createEl("button", { text: qf.label, cls: "cockpit-archive-quick-btn" });
    btn.addEventListener("click", () => {
      if (qf.label === "Last Month") {
        const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        fromInput.value = d.toISOString().split("T")[0];
        toInput.value = end.toISOString().split("T")[0];
      } else {
        const from = new Date(today);
        from.setDate(from.getDate() - qf.from);
        const to = new Date(today);
        to.setDate(to.getDate() - qf.to);
        fromInput.value = from.toISOString().split("T")[0];
        toInput.value = to.toISOString().split("T")[0];
      }
      doSearch();
    });
  }

  const searchInput = controls.createEl("input", { type: "text", placeholder: "Search title, project...", cls: "cockpit-archive-search" });
  const resultsEl = container.createDiv({ cls: "cockpit-archive-results" });

  let allResults: ArchiveResult[] = [];
  let displayCount = 50;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const doSearch = () => {
    resultsEl.empty();
    resultsEl.createEl("p", { text: "Searching...", cls: "cockpit-archive-loading" });

    allResults = searchArchive(fromInput.value, toInput.value, searchInput.value.toLowerCase(), ctx);
    displayCount = 50;
    renderResults();
  };

  const renderResults = () => {
    resultsEl.empty();
    if (allResults.length === 0) {
      resultsEl.createEl("p", { text: "No results found.", cls: "cockpit-archive-empty" });
      return;
    }
    resultsEl.createEl("p", { text: `${allResults.length} results`, cls: "cockpit-archive-count" });

    const table = resultsEl.createEl("table", { cls: "cockpit-archive-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "Title" });
    headerRow.createEl("th", { text: "Completed" });
    headerRow.createEl("th", { text: "Project" });
    headerRow.createEl("th", { text: "Labels" });

    const tbody = table.createEl("tbody");
    const toShow = allResults.slice(0, displayCount);

    for (const result of toShow) {
      const row = tbody.createEl("tr", { cls: "cockpit-archive-row" });
      const titleCell = row.createEl("td");
      const link = titleCell.createEl("a", { text: result.title, cls: "cockpit-archive-link" });
      link.addEventListener("click", () => {
        const file = ctx.app.vault.getAbstractFileByPath(result.path);
        if (file instanceof TFile) ctx.openCard({ file, displayTitle: result.title });
      });
      row.createEl("td", { text: result.completed || "" });
      row.createEl("td", { text: result.project || "" });
      row.createEl("td", { text: (result.labels || []).join(", ") });
    }

    if (allResults.length > displayCount) {
      const loadMore = resultsEl.createEl("button", {
        text: `Load more (${allResults.length - displayCount} remaining)`,
        cls: "cockpit-archive-load-more",
      });
      loadMore.addEventListener("click", () => { displayCount += 50; renderResults(); });
    }
  };

  fromInput.addEventListener("change", doSearch);
  toInput.addEventListener("change", doSearch);
  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  });

  doSearch();
}

function searchArchive(fromDate: string, toDate: string, query: string, ctx: ArchiveContext): ArchiveResult[] {
  const results: ArchiveResult[] = [];
  const from = new Date(fromDate + "T00:00:00");
  const to = new Date(toDate + "T23:59:59");

  const archiveFolder = ctx.app.vault.getAbstractFileByPath(ctx.settings.archiveFolder);
  if (!archiveFolder || !(archiveFolder instanceof TFolder)) return results;

  for (const yearFolder of archiveFolder.children) {
    if (!(yearFolder instanceof TFolder)) continue;
    const year = parseInt(yearFolder.name);
    if (isNaN(year) || year < from.getFullYear() || year > to.getFullYear()) continue;

    for (const monthFolder of yearFolder.children) {
      if (!(monthFolder instanceof TFolder)) continue;
      const month = parseInt(monthFolder.name);
      if (isNaN(month)) continue;

      for (const dayFolder of monthFolder.children) {
        if (!(dayFolder instanceof TFolder)) continue;
        const day = parseInt(dayFolder.name);
        if (isNaN(day)) continue;

        const folderDate = new Date(year, month - 1, day);
        if (folderDate < from || folderDate > to) continue;

        for (const file of dayFolder.children) {
          if (!(file instanceof TFile) || file.extension !== "md") continue;
          const cache = ctx.app.metadataCache.getFileCache(file);
          const fm = cache?.frontmatter || {};
          const title = fmStr(fm.title) || file.basename;
          const project = fmStr(fm.project);
          const labels = Array.isArray(fm.labels) ? fm.labels as string[] : [];
          const completed = fmStr(fm.completed);
          if (query) {
            const searchable = `${title} ${project} ${labels.join(" ")}`.toLowerCase();
            if (!searchable.includes(query)) continue;
          }
          results.push({ path: file.path, title, completed, project, labels });
        }
      }
    }
  }

  for (const specialFolder of ["reference", "unknown"]) {
    const sf = ctx.app.vault.getAbstractFileByPath(`${ctx.settings.archiveFolder}/${specialFolder}`);
    if (!sf || !(sf instanceof TFolder)) continue;
    for (const file of sf.children) {
      if (!(file instanceof TFile) || file.extension !== "md") continue;
      const cache = ctx.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter || {};
      const title = fmStr(fm.title) || file.basename;
      const project = fmStr(fm.project);
      const labels = Array.isArray(fm.labels) ? fm.labels as string[] : [];
      const completed = fmStr(fm.completed);
      if (query) {
        const searchable = `${title} ${project} ${labels.join(" ")}`.toLowerCase();
        if (!searchable.includes(query)) continue;
      }
      results.push({ path: file.path, title, completed, project, labels });
    }
  }

  results.sort((a, b) => (b.completed || "").localeCompare(a.completed || ""));
  return results;
}

export function loadArchiveCardsForRange(fromStr: string, toStr: string, ctx: ArchiveContext): CalendarCardData[] {
  const results: CalendarCardData[] = [];
  if (!ctx.settings.archiveFolder) return results;

  const archiveFolder = ctx.app.vault.getAbstractFileByPath(ctx.settings.archiveFolder);
  if (!archiveFolder || !(archiveFolder instanceof TFolder)) return results;

  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  for (const yearFolder of archiveFolder.children || []) {
    if (!(yearFolder instanceof TFolder)) continue;
    const y = parseInt(yearFolder.name);
    if (isNaN(y) || y < from.getFullYear() || y > to.getFullYear()) continue;
    for (const monthFolder of yearFolder.children || []) {
      if (!(monthFolder instanceof TFolder)) continue;
      const m = parseInt(monthFolder.name);
      if (isNaN(m)) continue;
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      if (monthEnd < from || monthStart > to) continue;
      for (const dayFolder of monthFolder.children || []) {
        if (!(dayFolder instanceof TFolder)) continue;
        for (const file of dayFolder.children || []) {
          if (!(file instanceof TFile) || file.extension !== "md") continue;
          const cache = ctx.app.metadataCache.getFileCache(file);
          const fm = cache?.frontmatter;
          if (!fm || !fm.due) continue;
          const dueStr = fmStr(fm.due);
          if (!dueStr) continue;
          const due = new Date(dueStr + "T00:00:00");
          if (due >= from && due <= to) {
            const title = fmStr(fm.title) || file.basename;
            const project = fmStr(fm.project);
            results.push({
              file: file,
              title,
              displayTitle: project ? `[${project}] ${title}` : title,
              due: dueStr,
              dueEnd: fmStr(fm.due_end),
              time: fmStr(fm.time),
              project,
              labels: Array.isArray(fm.labels) ? (fm.labels as string[]).filter(Boolean) : [],
              rawStatus: fmStr(fm.status),
              completed: fmStr(fm.completed),
              column: "done",
            });
          }
        }
      }
    }
  }
  return results;
}
