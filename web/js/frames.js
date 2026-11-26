// @ts-check
// Islands as frames: geometry primitives, drop, move, resize and reading order (ADR-0012, docs/design/canvas.md).
// The auto-layout (slots, growth, tidy) lives in island-layout.js.
// Pure: no DOM, unit-tested in test/frames.test.ts. The server applies the same overlap rule (src/core/canvas.ts).

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/**
 * An element to lay out. `w`/`h` is its element box (mostly room for a bubble); `slot` is the part of it the layout
 * spaces (dot and name), relative to the box — default the top left SLOT.w×SLOT.h. Bubbles never affect geometry.
 * @typedef {{ ref: string, island: string, rank: number, createdAt: number, w: number, h: number,
 *   slot?: Box, placed: { x: number, y: number } | null }} LayoutItem
 */
/** Slot memory: which list slot an auto-placed element holds in its island. @typedef {Map<string, { island: string, index: number }>} Slots */

export const FRAME = {
  gap: 28, // minimum distance between two frames
  pad: 24, // inner padding left, right, bottom
  top: 44, // inner padding at the top (room for the island name)
  minW: 220,
  minH: 160,
  rowGap: 80, // distance between auto-created frames in the row
};

/** The auto-layout list (docs/design/canvas.md "Auto-layout"): one slot per element, a new column every `perCol`. */
export const SLOT = { w: 200, h: 40, pitch: 48, perCol: 10, colGap: 24 };

/** @param {Box} a @param {Box} b */
export const framesOverlap = (a, b) =>
  a.x < b.x + b.w + FRAME.gap && b.x < a.x + a.w + FRAME.gap && a.y < b.y + b.h + FRAME.gap && b.y < a.y + a.h + FRAME.gap;

/** True when `box` (for island `id`) keeps its distance to every other frame. @param {Map<string, Box>} frames @param {string} id @param {Box} box */
export const frameFree = (frames, id, box) => [...frames].every(([k, f]) => k === id || !framesOverlap(box, f));

/** Area inside a frame where elements may sit. @param {Box} f */
export const inner = (f) => ({ x: f.x + FRAME.pad, y: f.y + FRAME.top, w: Math.max(0, f.w - 2 * FRAME.pad), h: Math.max(0, f.h - FRAME.top - FRAME.pad) });

/** Width of a frame that was never sized by the user and holds one column. */
export const defaultWidth = () => 2 * FRAME.pad + SLOT.w;

/** Slot `i` of the list, relative to the top left of the inner area. @param {number} i @returns {Box} */
export const slotAt = (i) => ({ x: Math.floor(i / SLOT.perCol) * (SLOT.w + SLOT.colGap), y: (i % SLOT.perCol) * SLOT.pitch, w: SLOT.w, h: SLOT.h });


/** Half the side of the square around a glyph that a drop keeps inside the island (world units). */
export const HOLD = 16;

/** Part of an element box a drop keeps inside its island, relative to the box: the square around the glyph for views
 * with an anchor (the rest of the box is room for a bubble, which places itself), else the whole box.
 * @param {{ x: number, y: number } | undefined} anchor @param {number} w @param {number} h @returns {Box} */
export const holdOf = (anchor, w, h) =>
  anchor ? { x: anchor.x - HOLD, y: anchor.y - HOLD, w: 2 * HOLD, h: 2 * HOLD } : { x: 0, y: 0, w, h };

/**
 * Where an element ends up after the user drops it (ADR-0012): inside its frame it stays; beyond the edge the frame grows
 * once to contain it, if that keeps it clear of the other frames; otherwise the element is kept inside. Only the
 * `hold` part of the box (relative to it, default the whole box) counts as "the element" here.
 * @param {Map<string, Box>} frames @param {string} id island @param {Box} el element box at the drop position
 * @param {Box} [hold] part of the box that must stay inside, relative to the box
 * @returns {{ el: { x: number, y: number }, frame: Box | null }} frame is set when it has to grow
 */
export function dropInFrame(frames, id, el, hold = { x: 0, y: 0, w: el.w, h: el.h }) {
  const f = /** @type {Box} */ (frames.get(id));
  const i = inner(f);
  const c = { x: el.x + hold.x, y: el.y + hold.y, w: hold.w, h: hold.h };
  const inside = c.x >= i.x && c.y >= i.y && c.x + c.w <= i.x + i.w && c.y + c.h <= i.y + i.h;
  if (inside) return { el: { x: el.x, y: el.y }, frame: null };
  const x1 = Math.min(f.x, c.x - FRAME.pad), y1 = Math.min(f.y, c.y - FRAME.top);
  const x2 = Math.max(f.x + f.w, c.x + c.w + FRAME.pad), y2 = Math.max(f.y + f.h, c.y + c.h + FRAME.pad);
  const grown = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  if (frameFree(frames, id, grown)) return { el: { x: el.x, y: el.y }, frame: grown };
  return {
    el: {
      x: Math.max(i.x, Math.min(i.x + Math.max(0, i.w - c.w), c.x)) - hold.x,
      y: Math.max(i.y, Math.min(i.y + Math.max(0, i.h - c.h), c.y)) - hold.y,
    },
    frame: null,
  };
}

/**
 * Move a frame by (dx, dy) as far as it stays clear of the others: the full move, else only one axis, else not at all.
 * @param {Map<string, Box>} frames @param {string} id @param {Box} start frame at drag start @param {number} dx @param {number} dy
 */
export function moveFrame(frames, id, start, dx, dy) {
  const want = { ...start, x: start.x + dx, y: start.y + dy };
  const cur = /** @type {Box} */ (frames.get(id));
  if (frameFree(frames, id, want)) return want;
  if (frameFree(frames, id, { ...cur, x: want.x })) return { ...cur, x: want.x };
  if (frameFree(frames, id, { ...cur, y: want.y })) return { ...cur, y: want.y };
  return cur;
}

/**
 * Resize a frame from its bottom-right corner: never smaller than its content or the minimum, never into another frame.
 * @param {Map<string, Box>} frames @param {string} id @param {Box} start @param {number} dw @param {number} dh @param {Box[]} content element boxes inside
 */
export function resizeFrame(frames, id, start, dw, dh, content) {
  const minW = Math.max(FRAME.minW, ...content.map((c) => c.x + c.w + FRAME.pad - start.x));
  const minH = Math.max(FRAME.minH, ...content.map((c) => c.y + c.h + FRAME.pad - start.y));
  const want = { ...start, w: Math.max(minW, start.w + dw), h: Math.max(minH, start.h + dh) };
  const cur = /** @type {Box} */ (frames.get(id));
  if (frameFree(frames, id, want)) return want;
  if (frameFree(frames, id, { ...cur, w: want.w })) return { ...cur, w: want.w };
  if (frameFree(frames, id, { ...cur, h: want.h })) return { ...cur, h: want.h };
  return cur;
}

/**
 * Reading order on the board (W / Q, ⌘⇧Enter): islands top to bottom, then left to right; inside an island the
 * same by element position. Entries without a frame or box go last, in their given order.
 * @param {{ ref: string, frame?: Box, box?: Box }[]} items @returns {string[]}
 */
export function readingOrder(items) {
  const far = { x: Infinity, y: Infinity, w: 0, h: 0 };
  const key = (/** @type {Box | undefined} */ b) => b ?? far;
  return items
    .map((it, i) => ({ ...it, i }))
    .sort((a, b) => {
      const fa = key(a.frame), fb = key(b.frame), ba = key(a.box), bb = key(b.box);
      return fa.y - fb.y || fa.x - fb.x || ba.y - bb.y || ba.x - bb.x || a.i - b.i;
    })
    .map((it) => it.ref);
}

