import { App, TFile, Notice } from "obsidian";
import type { CockpitBoardSettings, RecurringConfig } from "./types";
import { formatDateLocal } from "./ui/dom-helpers.js";
import { getMarkdownFilesAt } from "./vault-helpers";

interface TodayInfo {
  year: number;
  month: number;
  day: number;
  dow: number;
  hour: number;
  minute: number;
  dateStr: string;
}

export function matchesCron(cron: string, today: TodayInfo): boolean {
  const parts = cron.split(" ");
  if (parts.length < 5) return false;
  const [minute, hour, dom, month, dow] = parts;
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
  if (!matchField(dom, today.day) || !matchField(month, today.month) || !matchField(dow, today.dow)) {
    return false;
  }

  const currentMinutes = (today.hour * 60) + today.minute;
  for (let h = 0; h < 24; h++) {
    if (!matchField(hour, h)) continue;
    for (let m = 0; m < 60; m++) {
      if (matchField(minute, m)) {
        return currentMinutes >= ((h * 60) + m);
      }
    }
  }

  return false;
}

export async function checkRecurring(
  settings: CockpitBoardSettings,
  dismissed: Record<string, string>,
  app: App,
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
      hour: now.getHours(),
      minute: now.getMinutes(),
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

      // Quote free text so a project like "[[Client]]" or "Ops: infra"
      // stays a string instead of turning into a YAML list or mapping.
      const labels = (rule.labels || []).map(l => yamlStr(l)).join(", ");
      const content = `---\ntitle: ${yamlStr(cleanTitle)}\nstatus: scheduled\ndue: ${today.dateStr}\ntime:\ncompleted:\nproject: ${project ? yamlStr(project) : ""}\nlabels: [${labels}]\ncreated: ${today.dateStr}\nsource: recurring\n---\n\n# ${cleanTitle}\n`;

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

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Matches the recurring file itself and anything derived from it
// ("<slug>-recurring-cont-1"), but not an unrelated task whose slug merely
// starts the same way ("review" vs "review-budget").
function taskExistsForToday(
  slug: string,
  dateStr: string,
  folder: string,
  app: App,
): boolean {
  for (const child of getMarkdownFilesAt(app, folder)) {
    if (child.basename !== slug && !child.basename.startsWith(`${slug}-`)) continue;
    const cache = app.metadataCache.getFileCache(child);
    if (cache?.frontmatter?.due === dateStr) return true;
  }
  return false;
}
