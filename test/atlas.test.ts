// Atlas level (web/js/atlas.js) against ADR-0037 and docs/design/canvas.md "Atlas level".
import { expect, test } from "bun:test";
import { DORMANT_MS, fitName, isAtlas, nameSpot, summarise } from "../web/js/atlas.js";

const measure = (t: string) => t.length * 8;
const item = (o: Partial<Parameters<typeof summarise>[1][number]>) => ({
  ref: "r", island: "a", x: 0, y: 0, needs: false, ring: false, active: false, updatedAt: 0, ...o,
});
const NOW = 100 * DORMANT_MS;

test("The atlas starts below g = 0.5", () => {
  expect(isAtlas(0.49)).toBe(true);
  expect(isAtlas(0.5)).toBe(false);
});

test("Places are only the elements that need you, at their real position", () => {
  const s = summarise(["a", "b"], [
    item({ ref: "1", needs: true, x: 10, y: 20, active: true }),
    item({ ref: "2", needs: true, ring: true, x: 30, y: 40, active: true }),
    item({ ref: "3", x: 50, y: 60, active: true }), // working: not a place
    item({ ref: "4", island: "b", x: 70, y: 80 }),
  ], NOW);
  expect(s.get("a")!.places).toEqual([{ ref: "1", x: 10, y: 20, ring: false }, { ref: "2", x: 30, y: 40, ring: true }]);
  expect(s.get("b")!.places).toEqual([]);
});

test("Dormant: 7 days without activity, and nothing working or waiting", () => {
  const s = summarise(["a", "b", "c", "d"], [
    item({ island: "a", active: true }),
    item({ island: "b", updatedAt: NOW - DORMANT_MS - 1 }),
    item({ island: "c", updatedAt: NOW - 1000 }),
  ], NOW);
  expect(s.get("a")!.dormant).toBe(false);
  expect(s.get("b")!.dormant).toBe(true);
  expect(s.get("c")!.dormant).toBe(false);
  expect(s.get("d")!.dormant).toBe(true); // empty island
});

test("Island name: one line, else wrapped at a word, else none — never shortened", () => {
  expect(fitName("Orbit", 400, 300, measure)).toEqual(["Orbit"]);
  expect(fitName("Thought Leadership Personality", 220, 300, measure)).toEqual(["Thought Leadership", "Personality"]);
  expect(fitName("Supercalifragilistic", 100, 300, measure)).toBeNull();
  expect(fitName("Orbit", 400, 20, measure)).toBeNull();
});

test("The name never covers a place: it takes the first free spot from the top left, else it is dropped", () => {
  const lines = ["Orbit"]; // 40 px wide, 15.6 px high
  expect(nameSpot(lines, 200, 100, measure, [])).toEqual({ x: 18, y: 12 });
  expect(nameSpot(lines, 200, 100, measure, [{ x: 30, y: 18 }])).toEqual({ x: 42, y: 12 }); // right of the place
  const row = [30, 75, 120, 165].map((x) => ({ x, y: 18 }));
  expect(nameSpot(lines, 200, 100, measure, row)).toEqual({ x: 18, y: 30 }); // top row taken: below it
  const grid = [];
  for (let x = 0; x <= 200; x += 20) for (let y = 0; y <= 100; y += 20) grid.push({ x, y });
  expect(nameSpot(lines, 200, 100, measure, grid)).toBeNull();
});
