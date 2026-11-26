// @ts-check
// Placement of names, bubbles and edge hints (docs/design/canvas.md "Placement", ADR-0012). Pure: works on screen
// rectangles and a measuring callback, never touches the DOM, never moves dots or frames. Tested in test/placement.test.ts.

/** @typedef {import("./bubble-place.js").Rect} Rect */
/** @typedef {import("./bubble-place.js").Corner} Corner */
/** @typedef {"e" | "w"} Side */
/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} island
 * @property {number} x dot centre on screen
 * @property {number} y
 * @property {number} prio 3 needs the user, 2 working, 1 document, 0 resting — earlier wins conflicts
 * @property {0 | 1 | 2} attn the user's attention: 2 hovered/focused/open, 1 fresh event, 0 none
 * @property {(depth: number) => boolean} bubbleAt whether the element has a bubble at this depth
 * @property {boolean} [asks] waits for the user's answer: without room its bubble may overlay names, dots and the border
 */
/** @typedef {{ lp?: Side, bp?: Corner, lock?: Corner }} Sticky */
/** @typedef {{ depth: number, lab: { side: Side, w: number, rect: Rect } | null, bub: { corner: Corner, rect: Rect, shift: number } | null }} Placed */

import { GAP, bubbleRect, chooseBubble, clip, overlapArea, slidRect, touches } from "./bubble-place.js";

export { GAP, bubbleRect, overlapArea, slidRect };
export const LABEL_MIN = 70;
/** below this glyph scale names are too small to read and hidden, except for the element the user works with (ADR-0033) */
export const NAME_G_MIN = 0.5;

/** @param {{x:number,y:number}} p @param {Side} s @param {number} w @param {number} h @param {number} [g] @returns {Rect} */
export const labelRect = (p, s, w, h, g = 1) => ({ x: s === "e" ? p.x + 14 * g : p.x - 14 * g - w, y: p.y - h / 2, w, h });

/** depth from zoom: far 0, middle 1, near 2 @param {number} k */
export const baseDepth = (k) => (k >= 1.4 ? 2 : k >= 0.8 ? 1 : 0);

/**
 * Place every item. Order: (1) items the user works with, (2) edge hints, (3) the rest by priority, then id.
 * @param {{
 *   items: Item[], frames: Map<string, Rect>, W: number, H: number, base: number,
 *   measure: (id: string, depth: number) => { lab: { w: number, h: number }, bub: { w: number, h: number } | null },
 *   chrome: Rect[], obstacles: Rect[], links: { x1: number, y1: number, x2: number, y2: number }[],
 *   sticky: Map<string, Sticky>,
 *   g?: number,
 *   hints?: { items: { id: string, x: number, y: number }[], size: (id: string) => { w: number, h: number } },
 * }} p
 * @returns {{ placed: Map<string, Placed>, sticky: Map<string, Sticky>, hints: { id: string, x: number, y: number, angle: number }[] }}
 */
export function place(p) {
  const { W, H } = p;
  const g = p.g ?? 1;
  /** @type {Rect[]} */ const boxes = [...p.obstacles];
  /** @type {Rect[]} */ const chrome = [...p.chrome];
  /** @type {Rect[]} */ const bubbles = [];
  const dots = p.items.map((it) => ({ id: it.id, r: { x: it.x - 10 * g, y: it.y - 10 * g, w: 20 * g, h: 20 * g } }));
  // where each name will go (east of its dot, as measured): bubbles other than a question keep clear of it (canvas.md)
  const lanes = g < NAME_G_MIN ? [] : p.items.map((it) => {
    const m = p.measure(it.id, p.base).lab;
    return { id: it.id, r: labelRect(it, "e", m.w * g, m.h * g, g) };
  });
  /** @type {Rect[]} */ const linePts = [];
  for (const l of p.links) {
    const n = Math.max(1, Math.floor(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / 12));
    for (let i = 2; i < n - 1; i++) linePts.push({ x: l.x1 + ((l.x2 - l.x1) * i) / n - 2, y: l.y1 + ((l.y2 - l.y1) * i) / n - 2, w: 4, h: 4 });
  }
  const onScreen = (/** @type {Rect} */ r) => r.x >= 8 && r.y >= 8 && r.x + r.w <= W - 8 && r.y + r.h <= H - 8;
  /** cost of a rectangle for item `id`: overlaps (gap by kind), lines for bubbles only, chrome is hard @param {Rect} r @param {string} id @param {"bubble"|"label"} kind */
  const cost = (r, id, kind) => {
    const gap = GAP[kind];
    if (chrome.some((c) => touches(r, c))) return 1e9;
    let c = 0;
    for (const b of boxes) c += overlapArea(r, b, gap);
    for (const d of dots) if (d.id !== id) c += overlapArea(r, d.r, gap) * 4;
    if (kind === "bubble") for (const q of linePts) if (touches(r, q)) c += 60;
    return c + (onScreen(r) ? 0 : 1e6);
  };

  /** @type {Map<string, Placed>} */ const placed = new Map();
  /** @type {Map<string, Sticky>} */ const sticky = new Map();

  /** @param {Item} it */
  const placeOne = (it) => {
    const prev = p.sticky.get(it.id) ?? {};
    const s = /** @type {Sticky} */ ({ lp: prev.lp, bp: prev.bp, lock: it.attn >= 2 ? prev.lock : undefined });
    // the visible part of the island: names are shortened and bubbles slid at the screen edge as at the island edge
    const frame = clip(p.frames.get(it.island) ?? { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }, { x: 0, y: 0, w: W, h: H });
    const forced = it.attn >= 2;
    const want = Math.min(3, p.base + (it.attn ? 1 : 0));
    // forced: try the wanted depth first, then smaller ones (down to 1), so a locked corner never has to flip
    const tiers = forced ? Array.from({ length: Math.max(1, want) }, (_, i) => want - i) : Array.from({ length: want + 1 }, (_, i) => want - i);
    const otherFrames = [...p.frames].filter(([id]) => id !== it.island).map(([, f]) => f);
    const pick = chooseBubble(it, { s, prev, frame, tiers, g, measure: p.measure, cost, onScreen, hard: [...chrome, ...p.obstacles, ...otherFrames], bubbles, dots, lanes });
    /** @type {Placed} */
    const out = { depth: pick.depth, lab: null, bub: null };
    if (pick.corner && pick.rect) {
      out.bub = { corner: pick.corner, rect: pick.rect, shift: pick.shift ?? 0 };
      s.bp = pick.corner;
      boxes.push(pick.rect);
      bubbles.push(pick.rect);
    }

    out.lab = placeLabel(it, s, frame, pick.depth);
    placed.set(it.id, out);
    sticky.set(it.id, s);
  };

  /**
   * The name: always tried; shortened to the room inside the frame; hidden only without room or in conflict.
   * Remembers its side in `s.lp` and becomes an obstacle for later items.
   * @param {Item} it @param {Sticky} s @param {Rect} frame @param {number} depth @returns {Placed["lab"]}
   */
  const placeLabel = (it, s, frame, depth) => {
    if (g < NAME_G_MIN && it.attn < 2) return null; // too small to read (ADR-0033)
    const m = p.measure(it.id, depth).lab, lab = { w: m.w * g, h: m.h * g };
    // room up to the island edge and up to the next dot, bubble, name or chrome on the same line (then it is shortened, not hidden)
    const room = (/** @type {Side} */ side) => {
      const y1 = it.y - lab.h / 2, y2 = it.y + lab.h / 2;
      const inLine = (/** @type {Rect} */ r) => r.y < y2 && r.y + r.h > y1;
      const others = [...boxes, ...chrome, ...dots.filter((d) => d.id !== it.id).map((d) => d.r)].filter(inLine);
      if (side === "e") {
        const stop = Math.min(frame.x + frame.w - 10, ...others.filter((r) => r.x > it.x).map((r) => r.x - GAP.label));
        return stop - (it.x + 14 * g);
      }
      const stop = Math.max(frame.x + 10, ...others.filter((r) => r.x + r.w < it.x).map((r) => r.x + r.w + GAP.label));
      return it.x - 14 * g - stop;
    };
    const opt = (/** @type {Side} */ side) => {
      const w = Math.min(lab.w, room(side));
      const r = labelRect(it, side, Math.max(0, w), lab.h, g);
      return { side, w, rect: r, c: w < Math.min(LABEL_MIN * g, lab.w) ? 1e9 : cost(r, it.id, "label") };
    };
    // east is the rule, west the exception: only when east is blocked or clearly shorter; while the user works with the
    // element its side stays, so the name never jumps away from the pointer
    // a bubble in the way east does not send the name west: there it would read as part of the next name to the
    // left; the name gives way to the bubble (shortened or hidden) while the bubble is open
    const e = opt("e"), w = opt("w");
    const lane = { x: it.x + 14 * g, y: it.y - lab.h / 2, w: lab.w, h: lab.h };
    const bubbleEast = bubbles.some((r) => touches(r, lane));
    const west = !bubbleEast && w.c === 0 && (e.c > 0 || w.w > e.w + 24);
    const best = it.attn >= 2 && s.lp ? opt(s.lp) : bubbleEast ? e : west ? w : e.c <= w.c ? e : w;
    if (!(best.c < 1e6 && (best.c === 0 || it.attn || it.prio === 3))) return null;
    s.lp = best.side;
    boxes.push(best.rect);
    return { side: best.side, w: best.w, rect: best.rect };
  };

  const rank = (/** @type {Item} */ it) => -(it.attn * 10 + it.prio);
  const sorted = [...p.items].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
  const first = sorted.filter((it) => it.attn >= 2);
  first.forEach(placeOne);

  // edge hints: after what the user works with, before everything else; they keep clear of dots and of chrome
  const hints = p.hints ? edgeHints(p.hints.items, p.hints.size, W, H, [...chrome, ...boxes, ...dots.map((d) => d.r)]) : [];
  for (const h of hints) {
    const s = p.hints?.size(h.id) ?? { w: 0, h: 0 };
    const r = { x: h.x - s.w / 2, y: h.y - s.h / 2, w: s.w, h: s.h };
    chrome.push(r);
  }
  sorted.filter((it) => it.attn < 2).forEach(placeOne);
  return { placed, sticky, hints };
}

/**
 * Edge hints for elements outside the view: a pill at the board edge in their direction. Each slides along its edge,
 * alternating away from its ideal spot, to the nearest free place; without one it is dropped.
 * @param {{ id: string, x: number, y: number }[]} targets screen positions of off-screen elements
 * @param {(id: string) => { w: number, h: number }} size
 * @param {number} W @param {number} H @param {Rect[]} avoid
 * @returns {{ id: string, x: number, y: number, angle: number }[]} centres
 */
export function edgeHints(targets, size, W, H, avoid) {
  const m = 14, cx = W / 2, cy = H / 2, pad = 8;
  const list = targets
    .filter((t) => !(t.x > 12 && t.x < W - 12 && t.y > 12 && t.y < H - 12))
    .map((t) => {
      const { w, h } = size(t.id);
      const dx = t.x - cx, dy = t.y - cy;
      const s = Math.min((W / 2 - m - w / 2) / Math.abs(dx || 1e-6), (H / 2 - m - h / 2) / Math.abs(dy || 1e-6));
      return { id: t.id, w, h, x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  /** @type {{ id: string, x: number, y: number, angle: number, w: number, h: number }[]} */
  const out = [];
  const hit = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) => {
    const r = { x: x - w / 2 - pad, y: y - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad };
    return out.some((q) => touches(r, { x: q.x - q.w / 2, y: q.y - q.h / 2, w: q.w, h: q.h })) || avoid.some((a) => touches(r, a));
  };
  for (const h of list) {
    h.x = Math.max(m + h.w / 2, Math.min(W - m - h.w / 2, h.x));
    h.y = Math.max(m + h.h / 2, Math.min(H - m - h.h / 2, h.y));
    const vertical = h.x <= m + h.w / 2 + 1 || h.x >= W - m - h.w / 2 - 1;
    const step = vertical ? h.h + 6 : 24;
    for (let i = 0; i < 60; i++) {
      const d = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * step;
      const x = vertical ? h.x : h.x + d, y = vertical ? h.y + d : h.y;
      if (x < m + h.w / 2 || x > W - m - h.w / 2 || y < m + h.h / 2 || y > H - m - h.h / 2) continue;
      if (!hit(x, y, h.w, h.h)) {
        out.push({ ...h, x, y });
        break;
      }
    }
  }
  return out.map(({ id, x, y, angle }) => ({ id, x, y, angle }));
}
