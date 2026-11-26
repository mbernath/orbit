// Islands as frames (web/js/frames.js, ADR-0012) — pure geometry, tested without a browser.
import { expect, test } from "bun:test";
import { defaultWidth, dropInFrame, FRAME, frameFree, framesOverlap, HOLD, holdOf, inner, moveFrame, readingOrder, resizeFrame, SLOT } from "../web/js/frames.js";
import { layoutIslands, tidyIsland } from "../web/js/island-layout.js";

type Box = { x: number; y: number; w: number; h: number };
// a glyph view: 280×160 box (bubble room), its 200×40 slot with the dot at (12, 20) in it, the dot at (16, 80) in the box
const SL = { x: 4, y: 60, w: 200, h: 40 };
const item = (ref: string, island: string, extra: Record<string, unknown> = {}) =>
  ({ ref, island, rank: 0, createdAt: 0, w: 280, h: 160, slot: SL, placed: null, ...extra }) as any;
/** absolute slot rectangles of a layout */
const slotRects = (positions: Map<string, { x: number; y: number }>) =>
  new Map([...positions].map(([ref, p]) => [ref, { x: p.x + SL.x, y: p.y + SL.y, w: SL.w, h: SL.h }]));
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const n = (count: number, island = "a", from = 0) => Array.from({ length: count }, (_, i) => item(`s${from + i}`, island, { createdAt: from + i }));
const noOverlap = (frames: Map<string, Box>) => {
  const list = [...frames.values()];
  return list.every((a, i) => list.slice(i + 1).every((b) => !framesOverlap(a, b)));
};

test("Islands without a stored frame get one in a row, without overlap, as tall as their content", () => {
  const { frames, positions } = layoutIslands(["a", "b"], new Map(), [item("a1", "a"), item("a2", "a"), item("a3", "a"), item("b1", "b")]);
  const a = frames.get("a")!, b = frames.get("b")!;
  expect(a.x).toBe(0);
  expect(b.x).toBe(defaultWidth() + FRAME.rowGap);
  expect(noOverlap(frames)).toBe(true);
  // all slots inside their frame's inner area
  const rects = slotRects(positions);
  for (const [ref, isl] of [["a1", "a"], ["a2", "a"], ["a3", "a"], ["b1", "b"]] as const) {
    const s = rects.get(ref)!, f = inner(frames.get(isl)!);
    expect(s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h).toBe(true);
  }
});

test("Stored frames and positions stay; automatic elements make way", () => {
  const stored = new Map([["a", { x: 500, y: 300, w: 700, h: 400 }]]);
  const placed = { x: 520, y: 284 }; // its slot sits where slot 0 would be
  const { frames, positions } = layoutIslands(["a"], stored, [item("p", "a", { placed }), item("auto", "a")]);
  expect(frames.get("a")).toEqual({ x: 500, y: 300, w: 700, h: 400 });
  expect(positions.get("p")).toEqual(placed);
  const r = slotRects(positions);
  expect(hit(r.get("p")!, r.get("auto")!)).toBe(false);
  expect(r.get("auto")).toEqual({ x: 524, y: 344 + SLOT.pitch, w: 200, h: 40 }); // slot 1
});

test("A stored frame grows only downwards and only when there is room", () => {
  const stored = new Map([["a", { x: 0, y: 0, w: 400, h: 200 }], ["b", { x: 0, y: 250, w: 400, h: 200 }]]);
  const many = Array.from({ length: 4 }, (_, i) => item(`a${i}`, "a"));
  const { frames } = layoutIslands(["a", "b"], stored, many);
  expect(frames.get("a")!.h).toBeLessThan(250 - FRAME.gap); // never towards b
  expect(noOverlap(frames)).toBe(true);
  const alone = layoutIslands(["a"], new Map([["a", { x: 0, y: 0, w: 400, h: 200 }]]), many);
  expect(alone.frames.get("a")!.h).toBeGreaterThan(200);
});

test("If the frame cannot grow, a new element lands in a free slot inside the island", () => {
  // the two left columns covered by moved elements, a neighbour directly below
  const stored = new Map([["a", { x: 0, y: 0, w: 700, h: 400 }], ["b", { x: 0, y: 430, w: 700, h: 200 }]]);
  const placed = Array.from({ length: 7 }, (_, i) => item(`p${i}`, "a", { placed: { x: 132, y: -16 + i * 48 } }));
  const { frames, positions } = layoutIslands(["a", "b"], stored, [...placed, item("new", "a")]);
  expect(frames.get("a")!.h).toBe(400);
  const r = slotRects(positions), s = r.get("new")!, f = inner(frames.get("a")!);
  expect(s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h).toBe(true);
  for (const q of placed) expect(hit(s, r.get(q.ref)!)).toBe(false);
});

test("Dropping over the edge: the frame grows once, otherwise the element stays inside", () => {
  const frames = new Map<string, Box>([["a", { x: 0, y: 0, w: 400, h: 300 }], ["b", { x: 460, y: 0, w: 300, h: 300 }]]);
  // downwards is free: grow
  const down = dropInFrame(frames, "a", { x: 50, y: 400, w: 280, h: 124 });
  expect(down.frame!.h).toBeGreaterThan(300);
  expect(frameFree(frames, "a", down.frame!)).toBe(true);
  // to the right would touch b: kept inside
  const right = dropInFrame(frames, "a", { x: 350, y: 60, w: 280, h: 124 });
  expect(right.frame).toBeNull();
  const i = inner(frames.get("a")!);
  expect(right.el.x + 280).toBeLessThanOrEqual(i.x + i.w);
});

test("Moving and resizing keep a gap to other islands and never go below the content", () => {
  const frames = new Map<string, Box>([["a", { x: 0, y: 0, w: 400, h: 300 }], ["b", { x: 600, y: 0, w: 300, h: 300 }]]);
  const start = frames.get("a")!;
  expect(moveFrame(frames, "a", start, 50, 40)).toEqual({ x: 50, y: 40, w: 400, h: 300 });
  const blocked = moveFrame(frames, "a", start, 300, 0); // into b
  expect(frameFree(frames, "a", blocked)).toBe(true);
  const r = resizeFrame(frames, "a", start, -300, -300, [{ x: 36, y: 52, w: 280, h: 124 }]);
  expect(r.w).toBe(36 + 280 + FRAME.pad);
  expect(r.h).toBe(Math.max(FRAME.minH, 52 + 124 + FRAME.pad));
  expect(frameFree(frames, "a", resizeFrame(frames, "a", start, 500, 0, []))).toBe(true);
});

test("Reading order: islands top to bottom and left to right, inside by position; unplaced last", () => {
  const f = (x: number, y: number) => ({ x, y, w: 100, h: 100 });
  const order = readingOrder([
    { ref: "unplaced" },
    { ref: "right-top", frame: f(500, 0), box: f(510, 60) },
    { ref: "below", frame: f(0, 400), box: f(10, 460) },
    { ref: "left-second", frame: f(0, 0), box: f(10, 200) },
    { ref: "left-first", frame: f(0, 0), box: f(310, 60) },
  ]);
  expect(order).toEqual(["left-first", "left-second", "right-top", "below", "unplaced"]);
});

test("A dot can be dropped up to the island edge: only the field around the dot counts, not the room for the bubble", () => {
  const frames = new Map<string, Box>([["a", { x: 0, y: 0, w: 400, h: 300 }], ["b", { x: 460, y: 0, w: 300, h: 300 }]]);
  const i = inner(frames.get("a")!);
  const anchor = { x: 16, y: 80 };
  const hold = holdOf(anchor, 280, 160);
  // dot right at the inner right edge: the 280-wide box pokes out, the dot does not — it stays where dropped
  const atEdge = { x: i.x + i.w - anchor.x - HOLD, y: 60, w: 280, h: 160 };
  expect(dropInFrame(frames, "a", atEdge, hold)).toEqual({ el: { x: atEdge.x, y: atEdge.y }, frame: null });
  // dot near the top: the box starts above the frame, the dot is inside
  const nearTop = { x: 50, y: i.y - anchor.y + HOLD, w: 280, h: 160 };
  expect(dropInFrame(frames, "a", nearTop, hold).el).toEqual({ x: nearTop.x, y: nearTop.y });
  // dot beyond the right edge towards b: kept inside, with the dot (not the box) at the edge
  const beyond = dropInFrame(frames, "a", { x: 420, y: 60, w: 280, h: 160 }, hold);
  expect(beyond.frame).toBeNull();
  expect(beyond.el.x + anchor.x + HOLD).toBe(i.x + i.w);
  // views without an anchor still keep the whole box inside
  expect(holdOf(undefined, 280, 124)).toEqual({ x: 0, y: 0, w: 280, h: 124 });
});

test("Changing updatedAt leaves all positions unchanged (auto order is stable, ADR-0012)", () => {
  const refs = ["s1", "s2", "s3", "s4", "s5"];
  const before = layoutIslands(["a"], new Map(), refs.map((r, i) => item(r, "a", { createdAt: i, updatedAt: i })));
  const after = layoutIslands(["a"], new Map(), refs.map((r, i) => item(r, "a", { createdAt: i, updatedAt: 1000 - i * 7 + (i === 2 ? 5000 : 0) })));
  expect([...after.positions]).toEqual([...before.positions]);
  expect([...after.frames]).toEqual([...before.frames]);
});

// ---- Auto-layout acceptance criteria (docs/design/canvas.md "Auto-layout") ----

test("Area per session is at most 16k world px² for 4 sessions", () => {
  const f = layoutIslands(["a"], new Map(), n(4)).frames.get("a")!;
  expect((f.w * f.h) / 4).toBeLessThanOrEqual(16000);
});

test("For 1..30 sessions no two slots overlap and every slot lies inside the frame", () => {
  for (let count = 1; count <= 30; count++) {
    const { frames, positions } = layoutIslands(["a"], new Map(), n(count));
    const rects = [...slotRects(positions).values()], f = inner(frames.get("a")!);
    rects.forEach((r, i) => rects.slice(i + 1).forEach((q) => expect(hit(r, q)).toBe(false)));
    for (const r of rects) expect(r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h).toBe(true);
  }
});

test("A left-aligned list: one below the other at the row pitch, the 11th starts a new column", () => {
  const r = slotRects(layoutIslands(["a"], new Map(), n(11)).positions);
  const s0 = r.get("s0")!;
  for (let i = 1; i < 10; i++) expect(r.get(`s${i}`)).toEqual({ ...s0, y: s0.y + i * SLOT.pitch });
  expect(r.get("s10")).toEqual({ ...s0, x: s0.x + SLOT.w + SLOT.colGap });
});

test("Adding or removing one item leaves every other position unchanged; the next new one fills the hole", () => {
  const first = layoutIslands(["a"], new Map(), n(6));
  const removed = n(6).filter((it) => it.ref !== "s2");
  const after = layoutIslands(["a"], new Map(), removed, first.slots);
  for (const it of removed) expect(after.positions.get(it.ref)).toEqual(first.positions.get(it.ref));
  // a new one — even one that began earlier than all others — takes the hole and moves nobody
  const added = layoutIslands(["a"], new Map(), [...removed, item("new", "a", { createdAt: -5 })], after.slots);
  for (const it of removed) expect(added.positions.get(it.ref)).toEqual(first.positions.get(it.ref));
  expect(added.positions.get("new")).toEqual(first.positions.get("s2"));
});

test("Running the layout again with its own slots changes nothing (idempotent)", () => {
  const items = [...n(13), ...n(3, "b", 20)];
  const a = layoutIslands(["a", "b"], new Map(), items);
  const b = layoutIslands(["a", "b"], new Map(), items, a.slots);
  expect([...b.positions]).toEqual([...a.positions]);
  expect([...b.frames]).toEqual([...a.frames]);
  expect([...b.slots]).toEqual([...a.slots]);
});

test("Frames never overlap, with stored and fitted frames of any size", () => {
  const stored = new Map([["b", { x: 300, y: 0, w: 400, h: 300 }], ["d", { x: 0, y: 340, w: 260, h: 200 }]]);
  for (const count of [0, 1, 9, 10, 11, 25]) {
    const items = [...n(count, "a"), ...n(count, "b", 100), ...n(count, "c", 200), ...n(count, "d", 300)];
    expect(noOverlap(layoutIslands(["a", "b", "c", "d"], stored, items).frames)).toBe(true);
  }
});

test("Tidy island closes the holes in creation order and fits a stored frame; moved elements stay", () => {
  const stored = new Map([["a", { x: 0, y: 0, w: 600, h: 600 }]]);
  const first = layoutIslands(["a"], stored, n(6));
  const left = [...n(6).filter((it) => !["s1", "s3"].includes(it.ref)), item("moved", "a", { placed: { x: 300, y: 300 } })];
  const holes = layoutIslands(["a"], stored, left, first.slots);
  expect(holes.positions.get("s4")).toEqual(first.positions.get("s4"));
  const { frame, slots } = tidyIsland(["a"], stored, left, holes.slots, "a");
  const tidied = layoutIslands(["a"], new Map([["a", frame!]]), left, slots);
  expect(["s0", "s2", "s4", "s5"].map((r) => tidied.positions.get(r))).toEqual(["s0", "s1", "s2", "s3"].map((r) => first.positions.get(r)));
  expect(tidied.positions.get("moved")).toEqual({ x: 300, y: 300 });
  expect(frame!.w).toBeLessThan(600); // fitted around the list and the moved element
  expect(frame!.h).toBeLessThan(600);
  expect(frame!.x + frame!.w).toBeGreaterThanOrEqual(300 + SL.x + SL.w + FRAME.pad);
});

test("One-time tidy: islands without a hand-moved element close their holes, islands with one stay and are named", async () => {
  const { tidyOnce } = await import("../web/js/island-layout.js");
  // slot memory with holes in both islands (as left by removed dots)
  const items = [...n(3, "a"), ...n(3, "b", 10)];
  items[3] = { ...items[3]!, placed: { x: 500, y: 500 } } as any; // s10 in b was moved by hand
  const slots = new Map([
    ["s0", { island: "a", index: 0 }], ["s1", { island: "a", index: 2 }], ["s2", { island: "a", index: 5 }],
    ["s11", { island: "b", index: 1 }], ["s12", { island: "b", index: 4 }],
  ]);
  const out = tidyOnce(["a", "b"], new Map(), items, slots);
  expect(["s0", "s1", "s2"].map((r) => out.slots.get(r)?.index)).toEqual([0, 1, 2]);
  expect(out.slots.get("s11")).toEqual({ island: "b", index: 1 });
  expect(out.slots.get("s12")).toEqual({ island: "b", index: 4 });
  expect(out.hinted).toEqual(["b"]);
  // running it again changes nothing
  expect(tidyOnce(["a", "b"], new Map(), items, out.slots).slots).toEqual(out.slots);
});

// a stored frame holding three rows; island b right below it, c (optionally) right beside it
const short = { x: 0, y: 0, w: defaultWidth(), h: FRAME.top + FRAME.pad + SLOT.h + 2 * SLOT.pitch };
const below = { x: 0, y: short.h + FRAME.gap, w: 400, h: 200 };
const beside = { x: short.w + FRAME.gap, y: 0, w: 400, h: 200 };

test("A stored frame that can grow down grows down and keeps one column", () => {
  const { frames, positions } = layoutIslands(["a"], new Map([["a", short]]), n(5));
  const a = frames.get("a")!, f = inner(a);
  expect(a.w).toBe(short.w);
  expect(a.h).toBeGreaterThan(short.h);
  for (const r of slotRects(positions).values()) expect(r.x).toBe(f.x);
});

test("A stored frame blocked below wraps its slots into new columns of its own height and grows right", () => {
  const { frames, positions } = layoutIslands(["a", "b"], new Map([["a", short], ["b", below]]), n(7));
  const a = frames.get("a")!, f = inner(a), r = slotRects(positions);
  expect(a.h).toBe(short.h);
  expect(a.w).toBeGreaterThan(short.w);
  expect(noOverlap(frames)).toBe(true);
  const col = (ref: string) => Math.round((r.get(ref)!.x - f.x) / (SLOT.w + SLOT.colGap));
  expect(["s0", "s1", "s2", "s3", "s4", "s5", "s6"].map(col)).toEqual([0, 0, 0, 1, 1, 1, 2]);
  for (const s of r.values()) expect(s.x >= f.x && s.y >= f.y && s.x + s.w <= f.x + f.w && s.y + s.h <= f.y + f.h).toBe(true);
});

test("Blocked below and to the right, the frame keeps its size and the wrapped columns overflow to the right, never down", () => {
  const stored = new Map([["a", short], ["b", below], ["c", beside]]);
  const { frames, positions } = layoutIslands(["a", "b", "c"], stored, n(7));
  const a = frames.get("a")!, f = inner(a);
  expect(a).toEqual(short);
  const rects = [...slotRects(positions).values()];
  for (const s of rects) expect(s.y + s.h).toBeLessThanOrEqual(f.y + f.h);
  expect(rects.filter((s) => s.x >= f.x + f.w).length).toBe(4); // two columns beyond the edge
});

test("A frame too low for one slot still overflows down as the last resort", () => {
  const tiny = { ...short, h: FRAME.top + FRAME.pad + SLOT.h - 8 };
  const { positions } = layoutIslands(["a", "b"], new Map([["a", tiny], ["b", { ...below, y: tiny.h + FRAME.gap }]]), n(3));
  const xs = new Set([...slotRects(positions).values()].map((s) => s.x));
  expect(xs.size).toBe(1);
});
