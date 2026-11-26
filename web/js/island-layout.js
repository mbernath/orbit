// @ts-check
// The auto-layout of islands (ADR-0012, docs/design/canvas.md "Auto-layout"): slot assignment, frame fitting and
// growth, "Tidy island" and the one-time tidy. Pure: no DOM, unit-tested in test/frames.test.ts. Geometry primitives in frames.js.
import { FRAME, SLOT, frameFree, inner, slotAt } from "./frames.js";

/** @typedef {import("./frames.js").Box} Box */
/** @typedef {import("./frames.js").LayoutItem} LayoutItem */
/** @typedef {import("./frames.js").Slots} Slots */

/** @param {Box} a @param {Box} b */
const touch = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** creation order, never activity (ADR-0012) @param {LayoutItem} a @param {LayoutItem} b */
const byOrder = (a, b) => a.rank - b.rank || a.createdAt - b.createdAt || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
/** @param {LayoutItem} it @returns {Box} */
const slotOf = (it) => it.slot ?? { x: 0, y: 0, w: SLOT.w, h: SLOT.h };

/**
 * Slot indices of an island's auto-placed items: each keeps the index it held (`prev`) while that is free; the others
 * take the lowest free index in creation order — inside a stored frame first. Removed items leave holes; new ones fill them.
 * @param {string} id @param {LayoutItem[]} auto sorted @param {Box[]} taken slots of placed items (absolute)
 * With `wrap` (a stored frame that cannot grow down) the slots that do not fit go into further columns of the frame's
 * height instead of below it; a frame lower than one slot still overflows down.
 * @param {Box | null} box inner area of a stored frame, null for a frame that fits its content @param {Slots} prev
 * @param {boolean} [wrap]
 */
function assignSlots(id, auto, taken, box, prev, wrap = false) {
  const abs = (/** @type {number} */ i) => {
    const s = slotAt(i);
    return box ? { ...s, x: box.x + s.x, y: box.y + s.y } : s;
  };
  /** @type {Set<number>} */ const used = new Set();
  const free = (/** @type {number} */ i) => !used.has(i) && !(box && taken.some((t) => touch(t, abs(i))));
  const cols = box ? Math.max(1, Math.floor((box.w + SLOT.colGap) / (SLOT.w + SLOT.colGap))) : Infinity;
  const rows = box ? Math.min(SLOT.perCol, Math.floor((box.h - SLOT.h) / SLOT.pitch) + 1) : SLOT.perCol;
  const inside = Math.max(0, Math.min(cols * SLOT.perCol, 1e4));
  const fits = (/** @type {number} */ k) => !wrap || rows < 1 || k % SLOT.perCol < rows;
  /** @type {Map<string, number>} */ const index = new Map();
  for (const it of auto) {
    const p = prev.get(it.ref);
    if (p && p.island === id && free(p.index) && fits(p.index)) used.add(p.index), index.set(it.ref, p.index);
  }
  for (const it of auto) {
    if (index.has(it.ref)) continue;
    let i = -1;
    for (let k = 0; k < inside && i < 0; k++) if (k % SLOT.perCol < rows && free(k)) i = k;
    for (let k = 0; i < 0; k++) if (fits(k) && free(k)) i = k;
    used.add(i);
    index.set(it.ref, i);
  }
  return index;
}

/**
 * Frames for all islands, plus positions for all items. Rules:
 *  - stored element positions win; the others fill a left-aligned list of slots (SLOT), a new column every
 *    SLOT.perCol, and keep their slot index across runs through `prev` (docs/design/canvas.md "Auto-layout");
 *  - a stored frame keeps its position and size; it grows only when its slots do not fit, and only where no
 *    other frame is touched; blocked below, it wraps its slots into further columns of its own height (growing
 *    right if free, else they overflow to the right until the user tidies or resizes; down only if it is lower than one slot);
 *  - an island without a stored frame gets one in a row to the right of everything else, fitted to its slots.
 * Only the slot of an element counts; its bubble room never affects geometry.
 * @param {string[]} islands island ids in display order
 * @param {Map<string, Box>} stored frames stored by the user
 * @param {LayoutItem[]} items
 * @param {Slots} [prev] slot memory from the last run
 * @returns {{ frames: Map<string, Box>, positions: Map<string, { x: number, y: number }>, slots: Slots }}
 */
export function layoutIslands(islands, stored, items, prev = new Map()) {
  /** @type {Map<string, Box>} */
  const frames = new Map();
  for (const id of islands) if (stored.has(id)) frames.set(id, { .../** @type {Box} */ (stored.get(id)) });
  /** @type {Map<string, { x: number, y: number }>} */
  const positions = new Map();
  /** @type {Slots} */
  const slots = new Map([...prev].filter(([ref]) => !items.some((it) => it.ref === ref))); // absent ones keep theirs for a return

  /** @type {Map<string, { auto: LayoutItem[], index: Map<string, number>, taken: Box[] }>} */
  const plan = new Map();
  for (const id of islands) {
    const own = items.filter((it) => it.island === id);
    const f = frames.get(id);
    const taken = own.filter((it) => it.placed).map((it) => {
      const p = /** @type {{x:number,y:number}} */ (it.placed), s = slotOf(it);
      positions.set(it.ref, p);
      return { x: p.x + s.x, y: p.y + s.y, w: s.w, h: s.h };
    });
    const auto = own.filter((it) => !it.placed).sort(byOrder);
    const box = f ? inner(f) : null;
    let index = assignSlots(id, auto, taken, box, prev);
    // a stored frame that cannot grow down to hold its slots wraps them into further columns instead
    if (f && box) {
      const bottom = Math.max(0, ...[...index.values()].map((i) => box.y + slotAt(i).y + SLOT.h + FRAME.pad));
      if (bottom > f.y + f.h && !frameFree(frames, id, { ...f, h: bottom - f.y })) index = assignSlots(id, auto, taken, box, prev, true);
    }
    plan.set(id, { auto, taken, index });
  }

  // new frames go in a row to the right of the existing ones, each fitted to its list
  let nextX = Math.max(0, ...[...frames.values()].map((f) => f.x + f.w + FRAME.rowGap));
  for (const id of islands) {
    if (frames.has(id)) continue;
    const content = [...(plan.get(id)?.index.values() ?? [])].map(slotAt);
    const w = Math.max(FRAME.minW, 2 * FRAME.pad + Math.max(0, ...content.map((s) => s.x + s.w)));
    const h = Math.max(FRAME.minH, FRAME.top + FRAME.pad + Math.max(0, ...content.map((s) => s.y + s.h)));
    frames.set(id, { x: nextX, y: 0, w, h });
    nextX += w + FRAME.rowGap;
  }

  for (const id of islands) {
    const f = /** @type {Box} */ (frames.get(id));
    const { auto, index, taken } = /** @type {NonNullable<ReturnType<typeof plan.get>>} */ (plan.get(id));
    const box = inner(f);
    const boxes = [...taken];
    for (const it of auto) {
      const i = /** @type {number} */ (index.get(it.ref)), s = slotAt(i), o = slotOf(it);
      positions.set(it.ref, { x: box.x + s.x - o.x, y: box.y + s.y - o.y });
      slots.set(it.ref, { island: id, index: i });
      boxes.push({ ...s, x: box.x + s.x, y: box.y + s.y });
    }
    if (!stored.has(id)) continue;
    // a stored frame grows to hold its slots, if that keeps it clear of the others
    const right = Math.max(f.x + f.w, ...boxes.map((b) => b.x + b.w + FRAME.pad));
    const bottom = Math.max(f.y + f.h, ...boxes.map((b) => b.y + b.h + FRAME.pad));
    // both ways if there is room, else only down, else only right
    for (const grown of [{ ...f, w: right - f.x, h: bottom - f.y }, { ...f, h: bottom - f.y }, { ...f, w: right - f.x }])
      if ((grown.w > f.w || grown.h > f.h) && frameFree(frames, id, grown)) {
        frames.set(id, grown);
        break;
      }
  }
  return { frames, positions, slots };
}

/**
 * "Tidy island" (ADR-0012): the island's auto-placed elements forget their slots and close up in creation order;
 * a stored frame is fitted to its content (never into another frame). Placed elements stay.
 * @param {string[]} islands @param {Map<string, Box>} stored @param {LayoutItem[]} items @param {Slots} slots @param {string} id
 * @returns {{ frame: Box | null, slots: Slots }} frame: the fitted stored frame, null when the island has none
 */
export function tidyIsland(islands, stored, items, slots, id) {
  const f = stored.get(id);
  const small = new Map(stored);
  if (f) small.set(id, { ...f, w: FRAME.minW, h: FRAME.minH });
  const kept = new Map([...slots].filter(([, v]) => v.island !== id));
  const out = layoutIslands(islands, small, items, kept);
  if (!f) return { frame: null, slots: out.slots };
  const fit = /** @type {Box} */ (out.frames.get(id));
  // a neighbour kept the small frame from growing around its content: keep the old size instead
  const holds = items.filter((it) => it.island === id).every((it) => {
    const p = /** @type {{x:number,y:number}} */ (out.positions.get(it.ref)), s = slotOf(it);
    return p.x + s.x + s.w + FRAME.pad <= fit.x + fit.w && p.y + s.y + s.h + FRAME.pad <= fit.y + fit.h;
  });
  return { frame: holds ? fit : f, slots: out.slots };
}

/**
 * The one-time tidy after the list layout arrived (ADR-0012, 2026-11-26): every island none of whose elements has a
 * stored position gets "Tidy island" (its slots close up in creation order; stored frames keep their size). Islands
 * with a stored element position are left alone and named in `hinted`, so the board can point at "Tidy island".
 * @param {string[]} islands @param {Map<string, Box>} stored @param {LayoutItem[]} items @param {Slots} slots
 * @returns {{ slots: Slots, hinted: string[] }}
 */
export function tidyOnce(islands, stored, items, slots) {
  const hinted = islands.filter((id) => items.some((it) => it.island === id && it.placed));
  const clean = islands.filter((id) => !hinted.includes(id) && items.some((it) => it.island === id));
  const kept = new Map([...slots].filter(([, v]) => !clean.includes(v.island)));
  const out = layoutIslands(islands, stored, items, kept).slots;
  // islands left alone keep exactly what they had
  for (const [ref, v] of slots) if (!clean.includes(v.island)) out.set(ref, v);
  return { slots: out, hinted };
}
