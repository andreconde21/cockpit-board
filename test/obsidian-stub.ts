// Minimal stand-in for the "obsidian" module, so plugin logic can run under
// `node --test`. Only what the tested modules touch.

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  basename = "";
  extension = "md";
  stat = { ctime: 0, mtime: 0, size: 0 };
  constructor(path: string, ctime = 0) {
    super();
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.includes(".") ? this.name.split(".").pop() ?? "" : "";
    this.stat.ctime = ctime;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class FileSystemAdapter {
  constructor(private base: string) {}
  getFullPath(p: string): string { return `${this.base}/${p}`; }
  getBasePath(): string { return this.base; }
}

export const Platform = { isDesktopApp: true, isMobile: false, isWin: false, isMacOS: false, isLinux: true };

export function getFrontMatterInfo(content: string): { exists: boolean; frontmatter: string; contentStart: number } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  return m ? { exists: true, frontmatter: m[1], contentStart: m[0].length } : { exists: false, frontmatter: "", contentStart: 0 };
}

export const notices: string[] = [];
export class Notice {
  constructor(msg: string) { notices.push(msg); }
  setMessage(msg: string): this { notices.push(msg); return this; }
  hide(): void {}
}

export class MenuItem {
  title = "";
  handler?: () => void;
  setTitle(t: string): this { this.title = t; return this; }
  setIcon(): this { return this; }
  setDisabled(): this { return this; }
  setWarning(): this { return this; }
  setSection(): this { return this; }
  onClick(cb: () => void): this { this.handler = cb; return this; }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (i: MenuItem) => void): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(): void {}
}

export class Modal { constructor(public app: unknown) {} open(): void {} close(): void {} }
export class FuzzySuggestModal<T> extends Modal { setPlaceholder(): void {} declare _t: T; }
export class SuggestModal<T> extends FuzzySuggestModal<T> {}
export class Setting {}
export class PluginSettingTab {}
export class Plugin {}
export class ItemView {}
export function setIcon(): void {}
export async function requestUrl(): Promise<never> { throw new Error("no network in tests"); }
export function normalizePath(p: string): string { return p.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""); }
