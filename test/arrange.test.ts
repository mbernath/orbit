// Arranging several elements (web/js/arrange.js, ADR-0034) — pure geometry.
import { expect, test } from "bun:test";
import { align, distribute, GRID, inRect, shiftGroup, snap } from "../web/js/arrange.js";
import { HOLD, holdOf, inner } from "../web/js/frames.js";

const it = (ref: string, island: string, x: number, y: number) => ({ ref, island, x, y, w: 280, h: 160 });
const frames = new Map([
  ["a", { x: 0, y: 0, w: 1000, h: 600 }],
  ["b", { x: 0, y: 700, w: 1000, h: 600 }],
]);

test("Grid: values snap to 16", () => {
  expect(GRID).toBe(16);
  expect(snap(7)).toBe(0);
  expect(snap(9)).toBe(16);
  expect(snap(-9)).toBe(-16);
});

test("Moving a group: all by the same amount, distances stay", () => {
  const r = shiftGroup(frames, [it("1", "a", 40, 60), it("2", "a", 340, 100)], 20, 30);
  expect(r.moves).toEqual([{ ref: "1", x: 60, y: 90 }, { ref: "2", x: 360, y: 130 }]);
  expect(r.frames.size).toBe(0);
});

test("Moving a group: over the edge the island grows once, into another island never", () => {
  const grow = shiftGroup(frames, [it("1", "a", 40, 60), it("2", "a", 340, 60)], 400, 0);
  expect(grow.frames.get("a")!.w).toBeGreaterThan(1000);
  // downwards into island b: a cannot grow there, the group is kept inside a
  const down = shiftGroup(frames, [it("1", "a", 40, 60), it("2", "a", 340, 60)], 0, 900);
  expect(down.frames.size).toBe(0);
  const i = inner(frames.get("a")!);
  for (const m of down.moves) expect(m.y + 160).toBeLessThanOrEqual(i.y + i.h);
  expect(down.moves[0]!.x - down.moves[1]!.x).toBe(-300);
});

test("A group across two islands: each island on its own", () => {
  const r = shiftGroup(frames, [it("1", "a", 40, 60), it("2", "b", 40, 760)], 10, 0);
  expect(r.moves).toEqual([{ ref: "1", x: 50, y: 60 }, { ref: "2", x: 50, y: 760 }]);
});

test("Aligning on the dot, per island", () => {
  const items = [it("1", "a", 40, 60), it("2", "a", 100, 200), it("3", "b", 500, 800), it("4", "b", 300, 900)];
  expect(align(items, "left")).toEqual([
    { ref: "1", x: 40, y: 60 }, { ref: "2", x: 40, y: 200 }, { ref: "3", x: 300, y: 800 }, { ref: "4", x: 300, y: 900 },
  ]);
  expect(align(items, "bottom").map((m) => m.y)).toEqual([200, 200, 900, 900]);
  expect(align(items, "hcenter").map((m) => m.x)).toEqual([70, 70, 400, 400]);
  expect(align([it("1", "a", 1, 1), it("2", "b", 9, 9)], "top")).toEqual([]); // one per island: nothing to align
});

test("Distributing: equal gaps between the outermost, order stays", () => {
  const items = [it("1", "a", 0, 10), it("2", "a", 500, 20), it("3", "a", 90, 30)];
  expect(distribute(items, "h")).toEqual([{ ref: "1", x: 0, y: 10 }, { ref: "3", x: 250, y: 30 }, { ref: "2", x: 500, y: 20 }]);
  expect(distribute(items.slice(0, 2), "h")).toEqual([]);
  expect(distribute(items, "v").map((m) => m.y)).toEqual([10, 20, 30]);
});

test("A rectangle selects the elements whose dot lies inside it", () => {
  const a = { x: 16, y: 80 };
  const items = [{ ...it("1", "a", 0, 0), anchor: a }, { ...it("2", "a", 300, 0), anchor: a }];
  expect(inRect(items, { x1: 100, y1: 100, x2: 0, y2: 0 })).toEqual(["1"]);
  expect(inRect(items, { x1: 0, y1: 0, x2: 400, y2: 100 })).toEqual(["1", "2"]);
});

test("A group of dots: movable up to the edge, the room for bubbles doesn't count", () => {
  const anchor = { x: 16, y: 80 };
  const dot = (ref: string, x: number, y: number) => ({ ...it(ref, "a", x, y), hold: holdOf(anchor, 280, 160) });
  const side = new Map([["a", { x: 0, y: 0, w: 1000, h: 600 }], ["b", { x: 1040, y: 0, w: 400, h: 600 }]]);
  const i = inner(side.get("a")!);
  // right towards b: a cannot grow, the rightmost dot ends at the inner edge (its box pokes out)
  const r = shiftGroup(side, [dot("1", 40, 60), dot("2", 340, 60)], 2000, 0);
  expect(r.frames.size).toBe(0);
  expect(r.moves[1]!.x + anchor.x + HOLD).toBe(i.x + i.w);
  expect(r.moves[1]!.x - r.moves[0]!.x).toBe(300);
});
