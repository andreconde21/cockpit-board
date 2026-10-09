import { FileSystemAdapter, TFile, TFolder, getFrontMatterInfo } from "obsidian";

/** Parse the tiny YAML subset our cards use: `key: value` and `key: [a, b]`. */
function parseFm(content: string): Record<string, unknown> {
  const info = getFrontMatterInfo(content);
  const fm: Record<string, unknown> = {};
  if (!info.exists) return fm;
  for (const line of info.frontmatter.split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    let v: unknown = m[2].trim();
    if (typeof v === "string" && v.startsWith("[")) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean);
    else if (typeof v === "string") v = v.replace(/^"|"$/g, "");
    if (v === "") v = null;
    fm[m[1]] = v;
  }
  return fm;
}

function dumpFm(fm: Record<string, unknown>): string {
  return Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v ?? ""}`).join("\n");
}

/** An in-memory vault with just enough App surface for the plugin's helpers. */
export function fakeApp(files: Record<string, string>, opts: { vaultName?: string; base?: string } = {}) {
  const contents = new Map(Object.entries(files));
  const fmCache = new Map<string, Record<string, unknown>>();
  const fileObjs = new Map<string, TFile>();
  const folders = new Map<string, TFolder>();
  let tick = 0;

  const folderFor = (path: string): TFolder => {
    let f = folders.get(path);
    if (!f) {
      f = new TFolder(path);
      folders.set(path, f);
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (path !== "") {
        const parent = folderFor(parentPath);
        f.parent = parent;
        parent.children.push(f);
      }
    }
    return f;
  };
  const add = (path: string, content: string): TFile => {
    const file = new TFile(path, ++tick);
    fileObjs.set(path, file);
    contents.set(path, content);
    fmCache.set(path, parseFm(content));
    const parent = folderFor(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    file.parent = parent;
    parent.children.push(file);
    return file;
  };
  for (const [p, c] of Object.entries(files)) add(p, c);

  const app = {
    vault: {
      adapter: new FileSystemAdapter(opts.base ?? "/home/me/Vault"),
      getName: () => opts.vaultName ?? "My Vault",
      getAbstractFileByPath: (p: string) => fileObjs.get(p) ?? folders.get(p) ?? null,
      getMarkdownFiles: () => [...fileObjs.values()].filter((f) => f.extension === "md"),
      cachedRead: async (f: TFile) => contents.get(f.path) ?? "",
      read: async (f: TFile) => contents.get(f.path) ?? "",
      create: async (p: string, c: string) => add(p, c),
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: fmCache.get(f.path) }),
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = { ...(fmCache.get(f.path) ?? {}) };
        fn(fm);
        fmCache.set(f.path, fm);
        const body = (contents.get(f.path) ?? "").slice(getFrontMatterInfo(contents.get(f.path) ?? "").contentStart);
        contents.set(f.path, `---\n${dumpFm(fm)}\n---\n${body}`);
      },
      generateMarkdownLink: (f: TFile) => `[[${f.basename}]]`,
    },
  };
  return { app: app as unknown as import("obsidian").App, contents, fmCache, file: (p: string) => fileObjs.get(p)! };
}
