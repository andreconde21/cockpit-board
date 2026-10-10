// Quoting and naming helpers for the agent launcher. Pure functions, unit
// tested. Card text never goes through these into a command line: they are
// for settings values (paths, executable names, arguments) and our own slugs.

/** POSIX shell single-quoted literal. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell single-quoted literal (no expansion inside). */
export function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Lowercase a-z, 0-9 and single dashes; never empty. */
export function slug(s: string, max = 40): string {
  const out = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return out || "card";
}

/** Split an arguments field on whitespace; double quotes group, \" escapes. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "\"") { cur += "\""; i++; has = true; continue; }
    if (c === "\"") { inQuote = !inQuote; has = true; continue; }
    if (!inQuote && /\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

/**
 * A directory for `cd` in a POSIX shell. A leading `~` or `~/` stays
 * unquoted so the shell expands it; the rest is quoted.
 */
export function shDir(dir: string): string {
  if (dir === "~") return "~";
  if (dir.startsWith("~/")) return dir.length > 2 ? `~/${shq(dir.slice(2))}` : "~";
  return shq(dir);
}

/** Fill `{{name}}` placeholders; unknown names are left as they are. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m);
}

/** A POSIX command line from argv, every word quoted. */
export function shJoin(argv: string[]): string {
  return argv.map(shq).join(" ");
}

/** A PowerShell call from argv: `& 'exe' 'arg' ...`. */
export function psCall(argv: string[]): string {
  return `& ${argv.map(psq).join(" ")}`;
}
