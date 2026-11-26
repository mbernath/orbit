// @ts-check
// Local file references in text (ADR-0030): which link targets and inline code name a file, and at which line.
// Pure; the server resolves and checks the path when the reference is opened (files.open).

/** @typedef {{ path: string, line: number | null }} FileRef */

const LINE = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+|-\d+)?)$/;

/** @param {string} s @returns {FileRef} path and line, with the line suffix taken off */
function splitLine(s) {
  const m = s.match(LINE);
  if (!m) return { path: s, line: null };
  return { path: s.slice(0, m.index), line: Number(m[1] ?? m[2]) };
}

/**
 * The file a link target points to, or null if it is no local file. Relative targets need a base folder.
 * @param {string} href @param {string | null | undefined} base @returns {FileRef | null}
 */
export function linkTarget(href, base) {
  const h = href.trim();
  if (!h || h.startsWith("#")) return null;
  if (/^file:\/\//i.test(h)) return splitLine(h);
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // any other scheme: http, mailto, …
  if (h.startsWith("/") || h.startsWith("~/")) return splitLine(h);
  return base ? splitLine(h) : null;
}

/** Inline code that is clearly a path: path characters only, a file name with an extension, optionally :line. */
const CODE_PATH = /^[~\w.@+/-]*\/[\w.@+-]*\.[A-Za-z0-9]+(?::\d+(?::\d+|-\d+)?|#L\d+(?:-L?\d+)?)?$/;

/** A `/` somewhere is required too (`a.b` is not a path, `./a.md` is). @param {string} code @param {string | null | undefined} base @returns {FileRef | null} */
export function codeTarget(code, base) {
  const c = code.trim();
  if (!CODE_PATH.test(c) || c.startsWith("//")) return null;
  return linkTarget(c, base);
}
