// @ts-check
// Bubble choice for one glyph (docs/design/canvas.md "Placement", ADR-0012): corner search, slide into the island,
// depth drop, the locked corner while the user works with the element, and the overlay for a waiting question.
// Pure: rectangles in, a pick out. Called by placement.js, which owns the order and the names.

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** A corner of the dot, or "e": beside its name, level with the dot (may reach beyond the island's right border). @typedef {"ne" | "nw" | "se" | "sw" | "e"} Corner */
/** @typedef {import("./placement.js").Item} Item */
/** @typedef {import("./placement.js").Sticky} Sticky */
/** @typedef {{ depth: number, corner?: Corner, rect?: Rect, shift?: number }} Pick */

export const GAP = { bubble: 14, label: 4 };
export const CORNERS = /** @type {Corner[]} */ (["ne", "nw", "se", "sw"]);

/** @param {Rect} a @param {Rect} b @param {number} gap */
export function overlapArea(a, b, gap) {
  const ox = Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}
/** @param {Rect} a @param {Rect} b */
export const touches = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** intersection of two rectangles (empty: zero size) @param {Rect} a @param {Rect} b @returns {Rect} */
export const clip = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
};
/** @param {Rect} r @param {Rect} f @param {number} m */
export const insideOf = (r, f, m) => r.x >= f.x + m && r.y >= f.y + m && r.x + r.w <= f.x + f.w - m && r.y + r.h <= f.y + f.h - m;

/** Bubble rectangle at a corner of the dot (the corner nearest the dot is the one that points to it). @param {{x:number,y:number}} p @param {Corner} c @param {number} w @param {number} h @param {number} [g] glyph scale (ADR-0033): the offsets shrink, the bubble does not @returns {Rect} */
export const bubbleRect = (p, c, w, h, g = 1) =>
  c === "e" ? { x: p.x + 14 * g, y: p.y - h / 2, w, h } : { x: c[1] === "e" ? p.x - 4 * g : p.x + 4 * g - w, y: c[0] === "s" ? p.y + 24 * g : p.y - 22 * g - h, w, h };
/**
 * The bubble at a corner, slid sideways into the frame when the corner alone pokes out — but only between its two
 * corner positions (the dot stays above or below the bubble), so it keeps pointing at its dot.
 * @param {{x:number,y:number}} p @param {Corner} c @param {number} w @param {number} h @param {Rect} frame @param {number} [g]
 * @returns {{ rect: Rect, shift: number }}
 */
export function slidRect(p, c, w, h, frame, g = 1) {
  const r = bubbleRect(p, c, w, h, g);
  const lo = Math.max(frame.x + 8, p.x + 4 - w);
  const hi = Math.min(frame.x + frame.w - 8 - w, p.x - 4);
  if (lo > hi) return { rect: r, shift: 0 };
  const x = Math.min(Math.max(r.x, lo), hi);
  return { rect: { ...r, x }, shift: x - r.x };
}

/**
 * @typedef {object} Ctx
 * @property {Sticky} s @property {Sticky} prev @property {Rect} frame @property {number[]} tiers @property {number} g
 * @property {(id: string, depth: number) => { bub: { w: number, h: number } | null }} measure
 * @property {(r: Rect, id: string, kind: "bubble" | "label") => number} cost
 * @property {(r: Rect) => boolean} onScreen
 * @property {Rect[]} hard chrome, obstacles and other islands — never overlaid, not even by a question
 * @property {Rect[]} bubbles bubbles placed so far
 * @property {{ id: string, r: Rect }[]} dots
 * @property {{ id: string, r: Rect }[]} lanes where each dot's name goes (east of it) — also for names placed later
 */
/** @typedef {{ corner: Corner, rect: Rect, shift: number }} Spot */

/**
 * Choose depth and bubble for one item (docs/design/canvas.md "Placement"):
 *  - the element the user works with keeps its corner and may cover others (lockedSpot);
 *  - every other bubble takes only a free spot — inside its island, clear of every dot and every name, also of
 *    names placed after it — else the next smaller form, else none (it shows on hover);
 *  - only a waiting question (`asks`) without a free spot overlays names and dots of its own island (questionSpot).
 * Mutates `s.lock`.
 * @param {Item} it @param {Ctx} c @returns {Pick}
 */
export function chooseBubble(it, c) {
  const forced = it.attn >= 2;
  for (const t of c.tiers) {
    if (!it.bubbleAt(t)) return it.asks ? questionSpot(it, c) ?? { depth: t } : { depth: t };
    const size = /** @type {{w:number,h:number}} */ (c.measure(it.id, t).bub);
    if (forced) {
      const spot = lockedSpot(it, c, t, size);
      if (spot) return { depth: t, ...spot };
      continue;
    }
    const spot = freeSpot(it, c, size);
    if (spot) return { depth: t, ...spot };
  }
  return (it.asks ? questionSpot(it, c) : null) ?? { depth: 0 };
}

/**
 * The corner is chosen once when attention arrives and stays while the user works with the element. If the larger
 * bubble does not fit at that corner, it stays smaller instead of flipping: a flip would move the bubble away from
 * the pointer, end the hover and flip it back — a loop. Null: try the next smaller depth.
 * @param {Item} it @param {Ctx} c @param {number} t @param {{w:number,h:number}} size @returns {Spot | null}
 */
function lockedSpot(it, c, t, size) {
  const { s, frame, g } = c;
  if (!s.lock) s.lock = c.prev.bp;
  /** @type {Spot | null} */
  let best = null;
  if (s.lock) {
    const r = s.lock === "e" ? besideRect(it, c, size) : slidRect(it, s.lock, size.w, size.h, frame, g);
    const last = t === c.tiers[c.tiers.length - 1] || !it.bubbleAt(t - 1);
    if (!c.onScreen(r.rect) && !last) return null;
    best = { corner: s.lock, ...r };
  } else {
    let bc = Infinity;
    for (const k of CORNERS) {
      const r = slidRect(it, k, size.w, size.h, frame, g);
      const v = c.cost(r.rect, it.id, "bubble") + (insideOf(r.rect, frame, 8) ? 0 : 5000) + Math.abs(r.shift);
      if (v < bc) (bc = v), (best = { corner: k, ...r });
    }
  }
  s.lock = /** @type {Spot} */ (best).corner;
  return best;
}

/** A corner as it is first, then slid into the frame; the first free one wins. @param {Item} it @param {Ctx} c @param {{w:number,h:number}} size @returns {Spot | null} */
function freeSpot(it, c, size) {
  const order = cornersFrom(c.s.bp);
  const lanes = c.lanes.filter((l) => l.id !== it.id);
  for (const slide of [false, true])
    for (const k of order) {
      const r = slide ? slidRect(it, k, size.w, size.h, c.frame, c.g) : { rect: bubbleRect(it, k, size.w, size.h, c.g), shift: 0 };
      if ((slide && !r.shift) || !insideOf(r.rect, c.frame, 8) || c.cost(r.rect, it.id, "bubble") !== 0) continue;
      if (lanes.some((l) => touches(r.rect, l.r))) continue;
      return { corner: k, ...r };
    }
  return it.asks ? null : besideSpot(it, c, size, lanes);
}

/** corner order starting with the remembered one; "e" is not a corner @param {Corner | undefined} bp @returns {Corner[]} */
const cornersFrom = (bp) => [...new Set([bp && bp !== "e" ? bp : "ne", ...CORNERS])];

/** Beside the dot's own name, level with the dot. @param {Item} it @param {Ctx} c @param {{w:number,h:number}} size @param {number} [from] left edge @returns {{ rect: Rect, shift: number }} */
function besideRect(it, c, size, from) {
  const base = bubbleRect(it, "e", size.w, size.h, c.g);
  const own = c.lanes.find((l) => l.id === it.id)?.r;
  const x = from ?? (own ? own.x + own.w + 2 * GAP.label : base.x);
  return { rect: { ...base, x }, shift: x - base.x };
}

/**
 * A bubble other than a question that found no room inside its island (canvas.md "Placement"): beside its name, level
 * with its dot, and from there to the right — also beyond the island's right border onto free canvas. It keeps inside
 * the island vertically and covers no dot, name lane, island name, other island or chrome; if a longer name of a
 * neighbour is in the way it moves once past that name. Null: none.
 * @param {Item} it @param {Ctx} c @param {{w:number,h:number}} size @param {{ id: string, r: Rect }[]} lanes the others' @returns {Spot | null}
 */
function besideSpot(it, c, size, lanes) {
  const f = c.frame;
  const free = (/** @type {Rect} */ r) => r.x >= f.x + 8 && r.y >= f.y + 8 && r.y + r.h <= f.y + f.h - 8 &&
    c.cost(r, it.id, "bubble") === 0 && !c.hard.some((q) => touches(r, q));
  let r = besideRect(it, c, size);
  const hit = lanes.filter((l) => touches(r.rect, l.r));
  if (hit.length) r = besideRect(it, c, size, Math.max(...hit.map((l) => l.r.x + l.r.w)) + 2 * GAP.label);
  if (!free(r.rect) || lanes.some((l) => touches(r.rect, l.r))) return null;
  return { corner: "e", ...r };
}

/**
 * A waiting question without a free spot (ADR-0012): its smallest bubble may overlay names and dots of its own island
 * and its border — never another bubble, an island name, another island, chrome or the screen edge; names placed
 * after it give way. The corner that covers the least wins.
 * @param {Item} it @param {Ctx} c @returns {Pick | null}
 */
function questionSpot(it, c) {
  const t = c.tiers.filter((d) => d > 0 && it.bubbleAt(d)).pop();
  const size = t ? c.measure(it.id, t).bub : null;
  if (!t || !size) return null;
  /** @type {Pick | null} */ let pick = null;
  let bc = Infinity;
  for (const k of cornersFrom(c.s.bp)) {
    const r = bubbleRect(it, k, size.w, size.h, c.g);
    if (!c.onScreen(r) || c.hard.some((q) => touches(r, q)) || c.bubbles.some((q) => overlapArea(r, q, GAP.bubble) > 0)) continue;
    const v = c.cost(r, it.id, "bubble") + c.lanes.reduce((n, l) => n + (l.id === it.id ? 0 : overlapArea(r, l.r, 0)), 0);
    if (v < bc) (bc = v), (pick = { depth: t, corner: k, rect: r, shift: 0 });
  }
  return pick;
}
