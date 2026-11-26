// Placement of names, bubbles and edge hints (web/js/placement.js) against the criteria in docs/design/canvas.md.
import { expect, test } from "bun:test";
import { baseDepth, edgeHints, place } from "../web/js/placement.js";

type Rect = { x: number; y: number; w: number; h: number };
const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (r: Rect, f: Rect) => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h;

const W = 1200, H = 800;
const frames = new Map<string, Rect>([["a", { x: 40, y: 40, w: 700, h: 600 }]]);
const sizes: Record<number, { w: number; h: number } | null> = { 0: null, 1: { w: 240, h: 44 }, 2: { w: 330, h: 90 }, 3: { w: 330, h: 140 } };
const measure = (_id: string, depth: number) => ({ lab: { w: 180, h: 20 }, bub: sizes[depth] ?? null });
const item = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, island: "a", x, y, prio: 2, attn: 0, bubbleAt: (d: number) => d >= 1, ...extra }) as any;
const run = (items: any[], over: Record<string, unknown> = {}) =>
  place({ items, frames, W, H, base: 1, measure, chrome: [], obstacles: [], links: [], sticky: new Map(), ...over } as any);

const items = [item("s1", 120, 200), item("s2", 380, 220), item("s3", 140, 420, { prio: 0 }), item("s4", 420, 470, { prio: 3 })];

test("Zoom levels: far, middle, near", () => {
  expect([0.5, 0.9, 1.6].map(baseDepth)).toEqual([0, 1, 2]);
});

test("Running the layout twice in a row changes nothing", () => {
  const a = run(items);
  const b = run(items, { sticky: a.sticky });
  expect(JSON.stringify([...b.placed])).toBe(JSON.stringify([...a.placed]));
});

test("No name and no bubble leaves the island, nothing overlaps", () => {
  const { placed } = run(items);
  const rects: Rect[] = [];
  for (const p of placed.values()) {
    if (p.lab) rects.push(p.lab.rect);
    if (p.bub) rects.push(p.bub.rect);
  }
  for (const r of rects) expect(within(r, frames.get("a")!)).toBe(true);
  rects.forEach((r, i) => rects.slice(i + 1).forEach((q) => expect(touches(r, q)).toBe(false)));
});

test("Every element with room shows its name, even without attention and at the far level", () => {
  const { placed } = run(items, { base: 0 });
  for (const id of ["s1", "s2", "s3", "s4"]) expect(placed.get(id)!.lab).not.toBeNull();
});

test("A name is shortened instead of hidden when the island is too narrow", () => {
  const { placed } = run([item("edge", 640, 300)]);
  const lab = placed.get("edge")!.lab!;
  expect(lab).not.toBeNull();
  expect(lab.w).toBeGreaterThanOrEqual(70);
  expect(lab.w).toBeLessThanOrEqual(180);
});

test("If the bubble finds no room, the name stays anyway", () => {
  const crowded = run([item("x", 120, 200)], { obstacles: [{ x: 40, y: 40, w: 700, h: 140 }, { x: 40, y: 230, w: 700, h: 400 }] });
  const p = crowded.placed.get("x")!;
  expect(p.bub).toBeNull();
  expect(p.lab).not.toBeNull();
});

test("What the user looks at keeps its corner, even when the bubble grows", () => {
  const first = run(items);
  const corner = first.placed.get("s2")!.bub!.corner;
  const hovered = items.map((i) => (i.id === "s2" ? { ...i, attn: 2 } : i));
  const second = run(hovered, { sticky: first.sticky });
  expect(second.placed.get("s2")!.bub!.corner).toBe(corner);
  expect(second.placed.get("s2")!.depth).toBe(2);
});

test("Edge hints: at the edge, without covering dots, without overlapping each other", () => {
  const targets = [{ id: "far1", x: 1500, y: 300 }, { id: "far2", x: 1600, y: 310 }, { id: "far3", x: 1700, y: 320 }];
  const dot = { x: 1150, y: 290, w: 20, h: 20 };
  const hints = edgeHints(targets, () => ({ w: 200, h: 20 }), W, H, [dot]);
  expect(hints.length).toBe(3);
  const rects = hints.map((h) => ({ x: h.x - 100, y: h.y - 10, w: 200, h: 20 }));
  for (const r of rects) {
    expect(r.x + r.w).toBeLessThanOrEqual(W);
    expect(touches(r, dot)).toBe(false);
  }
  rects.forEach((r, i) => rects.slice(i + 1).forEach((q) => expect(touches(r, q)).toBe(false)));
  // visible elements get no hint
  expect(edgeHints([{ id: "in", x: 300, y: 300 }], () => ({ w: 200, h: 20 }), W, H, [])).toEqual([]);
});

test("A bubble slides sideways into the island instead of poking over the edge, and still points at its dot", () => {
  // a dot in the middle of a narrow island: no corner fits as it is (bubble 330 wide, island 400)
  const narrow = new Map<string, Rect>([["a", { x: 40, y: 40, w: 400, h: 600 }]]);
  for (const attn of [0, 2]) {
    const r = run([item("s", 240, 300, { attn })], { frames: narrow });
    const bub = r.placed.get("s")!.bub!;
    expect(bub).not.toBeNull();
    expect(within(bub.rect, { x: 48, y: 48, w: 384, h: 584 })).toBe(true); // inside, with the 8 px margin
    expect(bub.shift).not.toBe(0);
    expect(240).toBeGreaterThan(bub.rect.x); // the dot stays above or below the bubble
    expect(240).toBeLessThan(bub.rect.x + bub.rect.w);
  }
  // with room, nothing slides
  expect(run([item("s", 120, 200)]).placed.get("s")!.bub!.shift).toBe(0);
});

test("Hover at the top edge: the bubble stays where it is and rather doesn't grow than flip downwards", () => {
  // a dot near the top of the screen: the depth-1 bubble fits above it, the larger depth-2 one would not
  const top = new Map<string, Rect>([["a", { x: 40, y: 10, w: 700, h: 600 }]]);
  const it = item("s", 300, 92);
  const before = run([it], { frames: top });
  const corner = before.placed.get("s")!.bub!.corner;
  expect(corner[0]).toBe("n");
  const hovered = run([{ ...it, attn: 2 }], { frames: top, sticky: before.sticky });
  const bub = hovered.placed.get("s")!.bub!;
  expect(bub.corner).toBe(corner); // no flip: a flip would move the bubble away from the pointer and back
  expect(hovered.placed.get("s")!.depth).toBe(1);
  expect(bub.rect.y).toBe(before.placed.get("s")!.bub!.rect.y);
});

test("With another dot to the right, the name is shortened up to it instead of hidden", () => {
  // two dots on one line, 280 px apart; the name of the left one (180 wide in measure) does not fit in full
  const narrowMeasure = (_id: string, depth: number) => ({ lab: { w: 400, h: 20 }, bub: sizes[depth] ?? null });
  const r = run([item("l", 60, 300, { prio: 0 }), item("r", 340, 300, { prio: 0 })], { measure: narrowMeasure, base: 0 });
  const lab = r.placed.get("l")!.lab!;
  expect(lab).not.toBeNull();
  expect(lab.side).toBe("e");
  expect(lab.w).toBeGreaterThanOrEqual(70);
  expect(lab.rect.x + lab.rect.w).toBeLessThanOrEqual(340 - 10); // stops before the other dot
});

test("When the island pokes over the right screen edge, the name is shortened there instead of hidden", () => {
  // the island starts just left of the dot, so only the east side is left
  const wide = new Map<string, Rect>([["a", { x: 1050, y: 40, w: 450, h: 600 }]]);
  const lab = run([item("s", 1100, 300, { prio: 0 })], { frames: wide, base: 0 }).placed.get("s")!.lab!;
  expect(lab).not.toBeNull();
  expect(lab.side).toBe("e");
  expect(lab.w).toBeGreaterThanOrEqual(70);
  expect(lab.rect.x + lab.rect.w).toBeLessThanOrEqual(W - 8);
});

test("When the island pokes over the left screen edge, a name left of the dot is shortened there", () => {
  // the island ends just right of the dot, so only the west side is left
  const left = new Map<string, Rect>([["a", { x: -300, y: 40, w: 450, h: 600 }]]);
  const lab = run([item("s", 100, 300, { prio: 0 })], { frames: left, base: 0 }).placed.get("s")!.lab!;
  expect(lab).not.toBeNull();
  expect(lab.side).toBe("w");
  expect(lab.w).toBeGreaterThanOrEqual(70);
  expect(lab.rect.x).toBeGreaterThanOrEqual(8);
});

test("When chrome (minimap, bar) is in the line, the name is shortened before it instead of hidden", () => {
  const chrome = [{ x: 200, y: 250, w: 300, h: 100 }];
  const lab = run([item("s", 60, 300, { prio: 0 })], { chrome, base: 0 }).placed.get("s")!.lab!;
  expect(lab).not.toBeNull();
  expect(lab.side).toBe("e");
  expect(lab.w).toBeGreaterThanOrEqual(70);
  expect(touches(lab.rect, chrome[0]!)).toBe(false);
});

test("A name poking out of the top of the view is hidden", () => {
  const top = new Map<string, Rect>([["a", { x: 40, y: -100, w: 700, h: 600 }]]);
  expect(run([item("s", 300, 10, { prio: 0 })], { frames: top, base: 0 }).placed.get("s")!.lab).toBeNull();
});

test("Hover at the right screen edge: the bubble slides into view instead of getting smaller", () => {
  const wide = new Map<string, Rect>([["a", { x: 40, y: 40, w: 1460, h: 600 }]]);
  const sticky = new Map([["s", { bp: "ne" as const }]]);
  const r = run([item("s", 1100, 400, { attn: 2 })], { frames: wide, sticky });
  const p = r.placed.get("s")!;
  expect(p.depth).toBe(2);
  expect(p.bub!.corner).toBe("ne");
  expect(within(p.bub!.rect, { x: 8, y: 8, w: W - 16, h: H - 16 })).toBe(true);
  expect(1100).toBeLessThan(p.bub!.rect.x + p.bub!.rect.w); // still points at its dot
});

test("Right is the rule: when the right is free, a name moves back from the left, even if the left had room", () => {
  const sticky = new Map([["s", { lp: "w" as const }]]);
  const lab = run([item("s", 400, 300, { prio: 0 })], { sticky, base: 0 }).placed.get("s")!.lab!;
  expect(lab.side).toBe("e");
});

test("Left only as the exception: when something is in the way on the right", () => {
  const obstacles = [{ x: 430, y: 290, w: 100, h: 20 }];
  const lab = run([item("s", 400, 300, { prio: 0 })], { obstacles, base: 0 }).placed.get("s")!.lab!;
  expect(lab.side).toBe("w");
});

test("With a bubble in the way on the right, the name doesn't move left but avoids the bubble", () => {
  // the dot at the top of the island has room only at the lower right; its bubble covers the neighbour's name line
  const top = item("top", 300, 80, { prio: 3, attn: 2 });
  const below = item("below", 300, 122, { prio: 0 });
  const { placed } = run([top, below], { obstacles: [{ x: 40, y: 140, w: 250, h: 60 }] });
  const bub = placed.get("top")!.bub!;
  expect(bub.corner).toBe("se");
  const lab = placed.get("below")!.lab;
  if (lab) {
    expect(lab.side).toBe("e");
    expect(touches(lab.rect, bub.rect)).toBe(false);
  }
});

test("Below far: names and distances shrink with g, bubbles keep their size (ADR-0033)", () => {
  const one = [item("s1", 120, 200, { attn: 2 })];
  const full = run(one).placed.get("s1")!;
  const half = run(one, { g: 0.5 }).placed.get("s1")!;
  expect(half.lab!.rect.h).toBe(full.lab!.rect.h / 2);
  expect(half.lab!.rect.x - 120).toBe((full.lab!.rect.x - 120) / 2);
  expect(half.bub!.rect.w).toBe(full.bub!.rect.w);
  expect(half.bub!.rect.h).toBe(full.bub!.rect.h);
});

test("Below g 0.5 no names, except for the element the user is working with", () => {
  const { placed } = run([item("s1", 120, 200), item("s2", 400, 400, { attn: 2 })], { g: 0.4 });
  expect(placed.get("s1")!.lab).toBeNull();
  expect(placed.get("s2")!.lab).not.toBeNull();
});

test("Every waiting question gets a bubble in a 12-dot island with 3 waiting (it may overlay names and the border)", async () => {
  const { layoutIslands } = await import("../web/js/island-layout.js");
  const SL = { x: 4, y: 60, w: 200, h: 40 };
  const dots = Array.from({ length: 12 }, (_, i) => ({ ref: `d${i}`, island: "a", rank: 0, createdAt: i, w: 280, h: 160, slot: SL, placed: null }));
  const { frames: fr, positions } = layoutIslands(["a"], new Map(), dots as any);
  const f = fr.get("a")!, off = { x: 60 - f.x, y: 60 - f.y }; // the island on screen at (60, 60), scale 1
  const waiting = new Set(["d3", "d7", "d8"]);
  const items2 = dots.map((d) => {
    const p = positions.get(d.ref)!;
    return item(d.ref, p.x + 16 + off.x, p.y + 80 + off.y, { prio: waiting.has(d.ref) ? 3 : 0, asks: waiting.has(d.ref) });
  });
  const shown = new Map([["a", { ...f, x: 60, y: 60 }]]);
  const { placed } = run(items2, { frames: shown });
  for (const id of waiting) expect(placed.get(id)!.bub).not.toBeNull();
});

test("In a crowded island a done bubble never covers another name or dot: smaller form, else only on hover", async () => {
  const { layoutIslands } = await import("../web/js/island-layout.js");
  const SL = { x: 4, y: 60, w: 200, h: 40 };
  const dots = Array.from({ length: 12 }, (_, i) => ({ ref: `d${i}`, island: "a", rank: 0, createdAt: i, w: 280, h: 160, slot: SL, placed: null }));
  const { frames: fr, positions } = layoutIslands(["a"], new Map(), dots as any);
  const f = fr.get("a")!, off = { x: 60 - f.x, y: 60 - f.y };
  const done = new Set(["d0", "d3", "d5", "d9", "d11"]);
  const items2 = dots.map((d) => {
    const p = positions.get(d.ref)!;
    return item(d.ref, p.x + 16 + off.x, p.y + 80 + off.y, { prio: done.has(d.ref) ? 3 : 0 });
  });
  const shown = new Map([["a", { ...f, x: 60, y: 60 }]]);
  for (const base of [0, 1, 2]) {
    const { placed } = run(items2, { frames: shown, base });
    for (const id of done) {
      const bub = placed.get(id)!.bub;
      if (!bub) continue;
      for (const o of items2) {
        if (o.id === id) continue;
        expect(touches(bub.rect, { x: o.x - 10, y: o.y - 10, w: 20, h: 20 })).toBe(false);
        const lab = placed.get(o.id)!.lab;
        if (lab) expect(touches(bub.rect, lab.rect)).toBe(false);
        expect(touches(bub.rect, { x: o.x + 14, y: o.y - 10, w: 180, h: 20 })).toBe(false); // where its name goes
      }
    }
    // hovered, it shows anyway
    const hover = run(items2.map((it) => (it.id === "d5" ? { ...it, attn: 2 } : it)), { frames: shown, base });
    expect(hover.placed.get("d5")!.bub).not.toBeNull();
  }
});

/** a 10-dot single-column island on screen at (60, 60), dots d0, d2, d5, d7, d9 done (the others show no bubble); `right` adds another island next to it */
async function doneColumn(right: boolean) {
  const { layoutIslands } = await import("../web/js/island-layout.js");
  const SL = { x: 4, y: 60, w: 200, h: 40 };
  const dots = Array.from({ length: 10 }, (_, i) => ({ ref: `d${i}`, island: "a", rank: 0, createdAt: i, w: 280, h: 160, slot: SL, placed: null }));
  const { frames: fr, positions } = layoutIslands(["a"], new Map(), dots as any);
  const f = fr.get("a")!, off = { x: 60 - f.x, y: 60 - f.y };
  const list = dots.map((d) => {
    const p = positions.get(d.ref)!;
    const done = [0, 2, 5, 7, 9].map((i) => `d${i}`).includes(d.ref);
    return item(d.ref, p.x + 16 + off.x, p.y + 80 + off.y, done ? { prio: 3 } : { prio: 0, bubbleAt: () => false });
  });
  const a = { ...f, x: 60, y: 60 };
  const shown = new Map([["a", a]]);
  if (right) shown.set("b", { x: a.x + a.w + 28, y: 60, w: 400, h: a.h });
  return { list, a, ...run(list, { frames: shown, base: 1 }) };
}

test("List layout: with free canvas to the right, done bubbles show beside their names and cover no other name or dot", async () => {
  const { list, a, placed } = await doneColumn(false);
  for (const it of list) {
    if (it.prio !== 3) continue;
    const bub = placed.get(it.id)!.bub;
    expect(bub).not.toBeNull();
    expect(bub!.corner).toBe("e");
    expect(bub!.rect.x + bub!.rect.w).toBeGreaterThan(a.x + a.w); // reaches beyond the island's right border
    expect(bub!.rect.y).toBeGreaterThanOrEqual(a.y);
    expect(bub!.rect.y + bub!.rect.h).toBeLessThanOrEqual(a.y + a.h);
    for (const o of list) {
      if (o.id === it.id) continue;
      expect(touches(bub!.rect, { x: o.x - 10, y: o.y - 10, w: 20, h: 20 })).toBe(false);
      expect(touches(bub!.rect, { x: o.x + 14, y: o.y - 10, w: 180, h: 20 })).toBe(false); // where its name goes
      const lab = placed.get(o.id)!.lab;
      if (lab) expect(touches(bub!.rect, lab.rect)).toBe(false);
    }
    expect(placed.get(it.id)!.lab!.w).toBe(180); // its own name keeps its full width
  }
});

test("List layout: with another island directly to the right, done bubbles stay inside their island as before", async () => {
  const { list, a, placed } = await doneColumn(true);
  for (const it of list) {
    const bub = placed.get(it.id)!.bub;
    if (bub) expect(within(bub.rect, a)).toBe(true);
  }
});
