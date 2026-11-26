// List contract v1 (ADR-0036): reads a script's stdout into a normalised list. Pure, no I/O.
// Lenient by design: unknown fields are dropped, invalid items are skipped, only a missing `items` array fails.

export const LIST_VERSION = 1;
export const STATES = ["open", "active", "blocked", "done"] as const;
export const TONES = ["neutral", "accent", "good", "warn", "bad"] as const;
export type State = (typeof STATES)[number];
export type Tone = (typeof TONES)[number];

export type Badge = { text: string; tone: Tone };
export type ListItem = {
  id: string;
  title: string;
  state: State;
  stateLabel: string | null;
  ref: string | null;
  url: string | null;
  note: string | null;
  badges: Badge[];
  children: ListItem[];
};
export type Section = { id: string; title: string; collapsed: boolean; items: ListItem[] };
export type ListDoc = { title: string | null; summary: { text: string; tone: Tone } | null; sections: Section[] };

/** What the board shows without opening the list: counts per section, blocked count, items in total. */
export type Derived = { sections: { id: string; title: string; open: number }[]; blocked: number; total: number };

export type Parsed = { ok: true; list: ListDoc } | { ok: false; error: string };

const MAX_ITEMS = 1000; // across all levels; more is cut, the board is no issue tracker
const MAX_DEPTH = 6;
const IMPLICIT = "_";

const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const id = (v: unknown) => (typeof v === "number" ? String(v) : str(v, 200));
const tone = (v: unknown): Tone => (TONES.includes(v as Tone) ? (v as Tone) : "neutral");
const url = (v: unknown) => {
  const s = str(v, 2000);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

/** stdout and exit code of one run → the list, or a problem text for the board */
export function parseList(stdout: string, code: number): Parsed {
  let raw: any;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, error: code === 0 ? "The output is not JSON." : `The script exited with code ${code}.` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The output is not a JSON object." };
  const own = str(raw.error, 500);
  if (own) return { ok: false, error: own };
  if (code !== 0) return { ok: false, error: `The script exited with code ${code}.` };
  if (raw.version !== LIST_VERSION) return { ok: false, error: `Unknown contract version ${JSON.stringify(raw.version ?? null)}, expected ${LIST_VERSION}.` };
  if (!Array.isArray(raw.items)) return { ok: false, error: "The field “items” is missing." };

  let budget = MAX_ITEMS;
  const seen = new Set<string>();
  const item = (r: any, depth: number): ListItem | null => {
    const i = id(r?.id), title = str(r?.title);
    if (!i || !title || seen.has(i) || budget <= 0) return null;
    seen.add(i);
    budget--;
    return {
      id: i,
      title,
      state: STATES.includes(r.state) ? r.state : "open",
      stateLabel: str(r.stateLabel, 60),
      ref: id(r.ref)?.slice(0, 40) ?? null,
      url: url(r.url),
      note: str(r.note, 2000),
      badges: (Array.isArray(r.badges) ? r.badges : []).slice(0, 8).flatMap((b: any) => {
        const text = str(b?.text, 40);
        return text ? [{ text, tone: tone(b.tone) }] : [];
      }),
      children: depth < MAX_DEPTH && Array.isArray(r.children) ? r.children.map((c: any) => item(c, depth + 1)).filter(Boolean) as ListItem[] : [],
    };
  };

  const sections: Section[] = (Array.isArray(raw.sections) ? raw.sections : []).flatMap((s: any) => {
    const sid = id(s?.id);
    return sid ? [{ id: sid, title: str(s.title, 80) ?? sid, collapsed: s.collapsed === true, items: [] }] : [];
  });
  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const r of raw.items) {
    const it = item(r, 0);
    if (!it) continue;
    const sid = id(r.section);
    // an item without a known section goes to an untitled one at the end, so nothing is lost
    let sec = (sid && byId.get(sid)) || byId.get(IMPLICIT);
    if (!sec) byId.set(IMPLICIT, (sec = { id: IMPLICIT, title: sections.length ? "Other" : "", collapsed: false, items: [] })), sections.push(sec);
    sec.items.push(it);
  }
  const sum = str(raw.summary?.text, 120);
  return { ok: true, list: { title: str(raw.title, 80), summary: sum ? { text: sum, tone: tone(raw.summary.tone) } : null, sections } };
}

/** Counts for the far depths; `open` = not done, top level only, `blocked` across all levels. */
export function derive(list: ListDoc): Derived {
  let blocked = 0, total = 0;
  const walk = (items: ListItem[]) => items.forEach((i) => (total++, i.state === "blocked" && blocked++, walk(i.children)));
  list.sections.forEach((s) => walk(s.items));
  return {
    sections: list.sections.map((s) => ({ id: s.id, title: s.title, open: s.items.filter((i) => i.state !== "done").length })),
    blocked,
    total,
  };
}
