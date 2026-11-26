// @ts-check
// Arranging several elements (ADR-0034): grid, group move, align, distribute. Pure, unit-tested in test/arrange.test.ts.
// An element is placed by its box origin; every view's dot sits at the same offset inside it, so aligning boxes
// aligns dots. Every rule works per island, so nothing leaves its frame or changes island.
import { dropInFrame } from "./frames.js";

/** @typedef {import("./frames.js").Box} Box */
/** @typedef {Box & { ref: string, island: string, hold?: Box }} Item  hold: part kept inside the frame on a move, relative to the box */
/** @typedef {{ ref: string, x: number, y: number }} Move */
/** @typedef {"left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"} AlignMode */

export const GRID = 16;

/** @param {number} v */
export const snap = (v) => Math.round(v / GRID) * GRID;

/** @param {Item[]} items @returns {Map<string, Item[]>} */
const byIsland = (items) => {
  /** @type {Map<string, Item[]>} */
  const m = new Map();
  for (const it of items) m.set(it.island, [...(m.get(it.island) ?? []), it]);
  return m;
};

/** @param {Box[]} list @returns {Box} */
const hull = (list) => {
  const x1 = Math.min(...list.map((b) => b.x)), y1 = Math.min(...list.map((b) => b.y));
  const x2 = Math.max(...list.map((b) => b.x + b.w)), y2 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/**
 * Move a selection by (dx, dy). Per island, the hull of the parts its selected items hold inside the frame (`hold`,
 * see frames.js holdOf; default the whole box) is dropped like one element (dropInFrame): inside it stays, beyond the
 * edge the frame grows once if it can, else the hull is kept inside.
 * @param {Map<string, Box>} frames @param {Item[]} items @param {number} dx @param {number} dy
 * @returns {{ moves: Move[], frames: Map<string, Box> }} frames: only the islands that grow
 */
export function shiftGroup(frames, items, dx, dy) {
  /** @type {Move[]} */
  const moves = [];
  /** @type {Map<string, Box>} */
  const grown = new Map();
  for (const [island, list] of byIsland(items)) {
    if (!frames.has(island)) continue;
    const h = hull(list.map((it) => (it.hold ? { x: it.x + it.hold.x, y: it.y + it.hold.y, w: it.hold.w, h: it.hold.h } : it)));
    const r = dropInFrame(frames, island, { ...h, x: h.x + dx, y: h.y + dy });
    if (r.frame) grown.set(island, r.frame);
    const mx = r.el.x - h.x, my = r.el.y - h.y;
    for (const it of list) moves.push({ ref: it.ref, x: Math.round(it.x + mx), y: Math.round(it.y + my) });
  }
  return { moves, frames: grown };
}

/** Align the items of each island on one line. @param {Item[]} items @param {AlignMode} mode @returns {Move[]} */
export function align(items, mode) {
  /** @type {Move[]} */
  const moves = [];
  for (const list of byIsland(items).values()) {
    if (list.length < 2) continue;
    const xs = list.map((b) => b.x), ys = list.map((b) => b.y);
    const target = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      hcenter: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      vcenter: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
    }[mode];
    const horizontal = mode === "left" || mode === "right" || mode === "hcenter";
    for (const it of list) moves.push(horizontal ? { ref: it.ref, x: target, y: it.y } : { ref: it.ref, x: it.x, y: target });
  }
  return moves;
}

/**
 * Space the items of each island evenly between the outermost two, keeping their order on that axis.
 * @param {Item[]} items @param {"h" | "v"} axis @returns {Move[]}
 */
export function distribute(items, axis) {
  /** @type {Move[]} */
  const moves = [];
  const k = axis === "h" ? "x" : "y";
  for (const list of byIsland(items).values()) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a[k] - b[k] || a.ref.localeCompare(b.ref));
    const first = /** @type {Item} */ (sorted[0])[k], last = /** @type {Item} */ (sorted[sorted.length - 1])[k];
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((it, i) => moves.push({ ref: it.ref, x: it.x, y: it.y, [k]: Math.round(first + i * step) }));
  }
  return moves;
}

/**
 * Which items have their dot inside a world rectangle (any corner order).
 * @param {(Item & { anchor: { x: number, y: number } })[]} items @param {{ x1: number, y1: number, x2: number, y2: number }} r
 * @returns {string[]}
 */
export function inRect(items, r) {
  const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2), y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
  return items.filter((it) => {
    const x = it.x + it.anchor.x, y = it.y + it.anchor.y;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }).map((it) => it.ref);
}
