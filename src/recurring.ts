import { TFile, Notice } from "obsidian";
import type { CockpitBoardSettings, RecurringConfig } from "./types";
import { formatDateLocal } from "./ui/dom-helpers.js";

interface TodayInfo {
  year: number;
  month: number;
  day: number;
  dow: number;
  dateStr: string;
}

export function matchesCron(cron: string, today: TodayInfo): boolean {
  const parts = cron.split(" ");
  if (parts.length < 5) return false;
  const [, , dom, month, dow] = parts;
  const matchField = (field: string, value: number): boolean => {
    if (field === "*") return true;
    if (field.includes(",")) return field.split(",").some(v => parseInt(v) === value);
    if (field.includes("-")) {
      const [s, e] = field.split("-").map(Number);
      return value >= s && value <= e;
    }
    if (field.startsWith("*/")) return value % parseInt(field.slice(2)) === 0;
    return parseInt(field) === value;
  };
  return matchField(dom, today.day) && matchField(month, today.month) && matchField(dow, today.dow);
}

export async function checkRecurring(
  settings: CockpitBoardSettings,
  dismissed: Record<string, string>,
  app: {
    vault: {
      getAbstractFileByPath(path: string): unknown;
      read(file: TFile): Promise<string>;
      create(path: string, content: string): Promise<TFile>;
    };
    metadataCache: { getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null };
  },
): Promise<string[]> {
  if (!settings.recurringConfigPath) return [];

  try {
    const configFile = app.vault.getAbstractFileByPath(settings.recurringConfigPath);
    if (!configFile || !(configFile instanceof TFile)) return [];

    const raw = await app.vault.read(configFile);
    const config = JSON.parse(raw) as RecurringConfig;
    const tasks = config.tasks || [];

    const now = new Date();
    const today: TodayInfo = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      dow: now.getDay(),
      dateStr: formatDateLocal(now),
    };

    const created: string[] = [];
    const activeFolder = settings.folder;
    if (!activeFolder) return [];

    for (const rule of tasks) {
      if (!matchesCron(rule.cron, today)) continue;

      if (rule.frequency === "biweekly-2nd-sat") {
        if (Math.ceil(today.day / 7) !== 2) continue;
      }
      if (rule.frequency === "monthly-1st-mon") {
        if (today.day > 7) continue;
      }

      const title = rule.title;
      const projMatch = title.match(/^\[([^\]]+)\]\s*(.+)$/);
      const project = projMatch ? projMatch[1] : (rule.project || "");
      const cleanTitle = projMatch ? projMatch[2] : title;
      const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);

      if (taskExistsForToday(slug, today.dateStr, activeFolder, app)) continue;
      if (dismissed[slug] === today.dateStr) continue;

      const labels = (rule.labels || []).map(l => `"${l}"`).join(", ");
      const content = `---\ntitle: "${cleanTitle.replace(/"/g, '\\"')}"\nstatus: scheduled\ndue: ${today.dateStr}\ntime:\ncompleted:\nproject: ${project}\nlabels: [${labels}]\ncreated: ${today.dateStr}\nsource: recurring\n---\n\n# ${cleanTitle}\n`;

      const filename = `${slug}-recurring.md`;
      const path = `${activeFolder}/${filename}`;
      if (!app.vault.getAbstractFileByPath(path)) {
        await app.vault.create(path, content);
        created.push(cleanTitle);
      }
    }

    if (created.length > 0) {
      new Notice(`\uD83D\uDD04 Created ${created.length} recurring task(s): ${created.join(", ")}`, 5000);
    }
    return created;
  } catch (e: unknown) {
    console.error("Cockpit Board: recurring check failed", e);
    return [];
  }
}

function taskExistsForToday(
  slug: string,
  dateStr: string,
  folder: string,
  app: {
    vault: { getAbstractFileByPath(path: string): unknown };
    metadataCache: { getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null };
  },
): boolean {
  const folderObj = app.vault.getAbstractFileByPath(folder) as { children?: unknown[] } | null;
  if (!folderObj) return false;
  for (const child of folderObj.children || []) {
    if (!(child instanceof TFile)) continue;
    if (child.name.startsWith(slug) && child.extension === "md") {
      const cache = app.metadataCache.getFileCache(child);
      if (cache?.frontmatter?.due === dateStr) return true;
    }
  }
  return false;
}
