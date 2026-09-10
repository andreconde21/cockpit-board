// Filenames for cards derived from an existing card: "Duplicate card" adds
// "-copy-N", "Split and close" adds "-cont-N". Kept free of Obsidian imports
// so the naming rules can be checked outside the app.

export type DerivedSuffix = "copy" | "cont";

// Upper bound for a derived card's filename in UTF-8 bytes, extension
// included. Filesystems cap a single name at 255 bytes (ext4 NAME_MAX); the
// headroom leaves room for sync tools that rename files on conflict
// (Syncthing appends ".sync-conflict-YYYYMMDD-HHMMSS-XXXXXXX").
export const MAX_DERIVED_NAME_BYTES = 200;

// Any trailing mix of derived segments, in any order: "-copy", "-cont-4",
// "-copy-cont-cont-2-copy-1-cont-4", ...
const DERIVED_CHAIN = /(?:-(?:copy|cont)(?:-\d+)?)+$/;

// Keeps a misbehaving `isTaken` from spinning forever on the UI thread.
const MAX_ATTEMPTS = 100000;

/** A card's basename with its trailing -copy/-cont chain removed. */
export function derivedRoot(basename: string): string {
  return basename.replace(DERIVED_CHAIN, "");
}

/**
 * Path for a card derived from `sourcePath`, in the same folder:
 * "<root>-<suffix>-<n>.md". <root> drops every -copy/-cont segment the
 * source name had collected, so alternating duplicate and split never grows
 * the name, and <n> is the lowest number for which `isTaken` returns false.
 * <root> is cut at a character boundary when needed to stay within `maxBytes`.
 */
export function nextDerivedPath(
  sourcePath: string,
  suffix: DerivedSuffix,
  isTaken: (path: string, basename: string) => boolean,
  maxBytes: number = MAX_DERIVED_NAME_BYTES,
): string {
  const slash = sourcePath.lastIndexOf("/");
  const dir = sourcePath.slice(0, slash + 1);
  const root = derivedRoot(sourcePath.slice(slash + 1).replace(/\.md$/, "")) || "card";
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const tail = `-${suffix}-${n}`;
    // A cut can leave a dangling "-", "." or space; trailing dots and spaces
    // are also invalid in Windows filenames.
    const base = truncateUtf8(root, maxBytes - utf8Length(`${tail}.md`)).replace(/[\s.-]+$/, "") || "card";
    const basename = base + tail;
    const path = `${dir}${basename}.md`;
    if (!isTaken(path, basename)) return path;
  }
  throw new Error(`no free "-${suffix}" filename for ${sourcePath}`);
}

function utf8CharBytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function utf8Length(s: string): number {
  let bytes = 0;
  for (const ch of s) bytes += utf8CharBytes(ch.codePointAt(0) ?? 0);
  return bytes;
}

/** Longest prefix of `s` that fits in `maxBytes` of UTF-8 without splitting a character. */
function truncateUtf8(s: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of s) {
    bytes += utf8CharBytes(ch.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    end += ch.length;
  }
  return s.slice(0, end);
}
