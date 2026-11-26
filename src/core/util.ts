import { resolve, sep } from "node:path";

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function expandHome(p: string) {
  return resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
}

/** True when `path` is `root` or lies below it. Both must be absolute. */
export const isWithinPath = (path: string, root: string) => path === root || path.startsWith(root + sep);

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-") || "workspace";

/** Slug for names the user reads in paths (memory files, worktrees): German umlauts spelled out, "Aufräumer" → "aufraeumer". */
export const slugDe = (s: string) =>
  slug(s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss"));

export const json =(body: unknown, status = 200) => Response.json(body, { status });
export const problem = (status: number, error: string) => Response.json({ error }, { status });

// Title protocol for sessions Orbit starts (ADR-0032): the first reply opens with "[Title: …]".
// The owned source asks for it, the claude source reads it; both strip it from what the board shows.
// Sessions started before the English product (ADR-0039) opened with "[Titel: …]"; that form is still read.
export const TITLE_PROMPT =
  "Begin your very first reply in this conversation with one line of the form `[Title: <3 to 6 words>]` that names the task, " +
  "in the language of the user's request, followed by a blank line. Never write that line again in later replies.";
const TITLE_LINE = /^\s*\[(?:Title|Titel):\s*([^\]\n]+?)\s*\]\s*(?:\n\s*)?/;
/** Cheap pre-filter for a transcript line that may hold a title line, old or new form. */
export const hasTitleMarker = (line: string) => line.includes("[Title:") || line.includes("[Titel:");

/** The title a reply opens with (or null) and the reply without that line. */
export function splitTitle(text: string): { title: string | null; rest: string } {
  const m = text.match(TITLE_LINE);
  return m ? { title: m[1]!, rest: text.slice(m[0].length) } : { title: null, rest: text };
}
