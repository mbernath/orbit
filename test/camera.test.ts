// Camera rules (web/js/camera.js, ADR-0012) — pure, tested without a browser.
import { expect, test } from "bun:test";
import { fit, glyphScale, LEVEL_K, pan, reveal, ZOOM, zoomAt } from "../web/js/camera.js";

test("Zooming keeps the point under the pointer fixed and stays within the limits", () => {
  const v = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 50);
  expect(v.k).toBe(2);
  expect(100 - v.x).toBe(200); // world point 100 still at screen 100: 100*2 + x = 100
  expect(zoomAt({ x: 0, y: 0, k: 1 }, 100, 0, 0).k).toBe(ZOOM.max);
  expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.001, 0, 0).k).toBe(ZOOM.min);
});

test("Revealing moves only as far as needed and never zooms", () => {
  const v = { x: 0, y: 0, k: 1 };
  // already visible: same object, nothing moves
  expect(reveal(v, { x: 200, y: 200, w: 50, h: 50 }, 1000, 800)).toBe(v);
  // right of the screen: shift left just until it is 48 px inside
  const r = reveal(v, { x: 1100, y: 200, w: 50, h: 50 }, 1000, 800);
  expect(r.k).toBe(1);
  expect(r.y).toBe(0);
  expect(1100 + 50 + r.x).toBe(1000 - 48);
  // above: shift down
  expect(reveal(v, { x: 200, y: -300, w: 50, h: 50 }, 1000, 800).y).toBe(348);
});

test("Panning and fitting", () => {
  expect(pan({ x: 1, y: 2, k: 1 }, 10, 20)).toEqual({ x: 11, y: 22, k: 1 });
  const f = fit({ x1: 0, y1: 0, x2: 860, y2: 660 }, 1000, 800);
  expect(f.k).toBe(1);
  expect(fit(null, 1000, 800)).toEqual({ x: 60, y: 120, k: 1 });
});

test("Glyphs only shrink below the far level (ADR-0033)", () => {
  expect(glyphScale(LEVEL_K.far)).toBe(1);
  expect(glyphScale(1.8)).toBe(1);
  expect(glyphScale(LEVEL_K.far / 2)).toBeCloseTo(0.5);
});

test("The first start never zooms out further than far, otherwise top left", () => {
  const f = fit({ x1: 100, y1: 50, x2: 6100, y2: 4050 }, 1000, 800, 70, LEVEL_K.far);
  expect(f.k).toBe(LEVEL_K.far);
  expect(f.x).toBeCloseTo(70 - 100 * LEVEL_K.far);
  expect(f.y).toBeCloseTo(70 - 50 * LEVEL_K.far);
  // fits anyway: unchanged
  expect(fit({ x1: 0, y1: 0, x2: 860, y2: 660 }, 1000, 800, 70, LEVEL_K.far)).toEqual(fit({ x1: 0, y1: 0, x2: 860, y2: 660 }, 1000, 800));
});

test("A top inset (a visible notice) keeps the fitted box below it", () => {
  const b = { x1: 0, y1: 0, x2: 860, y2: 660 };
  const f = fit(b, 1000, 800, 70, ZOOM.min, 60);
  expect(b.y1 * f.k + f.y).toBeGreaterThanOrEqual(60 + 70);
  expect(b.y2 * f.k + f.y).toBeLessThanOrEqual(800 - 70);
  expect(fit(b, 1000, 800, 70, ZOOM.min, 0)).toEqual(fit(b, 1000, 800));
});
