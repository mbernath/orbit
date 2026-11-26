// @ts-check
// Draws the minimap (ADR-0013, ADR-0037): the atlas summary at small size — frames, and the places that need the user as
// orange dots at their real position; faded when dormant; no names (name on hover via title).
// The view is a cut-out: outside it is darkened. Hidden at the atlas level and when the whole canvas is in view.
import { currentFrames } from "./render.js";
import { store } from "./store.js";

/** @typedef {import("./camera.js").View} View */

let mapGeom = { x1: 0, y1: 0, s: 1, ox: 0, oy: 0 };
/** @type {[string, { x: number, y: number, w: number, h: number }][]} frames in minimap coordinates, for hover names */
let mapFrames = [];

/**
 * @param {HTMLElement} viewport @param {View} view @param {number} W @param {number} H @param {boolean} atlas
 * @param {Map<string, import("./atlas.js").Summary>} summaries
 */
export function drawMinimap(viewport, view, W, H, atlas, summaries) {
  const box = /** @type {HTMLElement | null} */ (viewport.querySelector(".minimap"));
  const cv = /** @type {HTMLCanvasElement | null} */ (box?.querySelector("canvas"));
  if (!box || !cv) return;
  const fr = [...currentFrames()];
  const vx1 = -view.x / view.k, vy1 = -view.y / view.k, vw = W / view.k, vh = H / view.k;
  const allVisible = fr.every(([, f]) => f.x >= vx1 && f.y >= vy1 && f.x + f.w <= vx1 + vw && f.y + f.h <= vy1 + vh);
  box.hidden = atlas || allVisible || !fr.length;
  if (box.hidden) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) (cv.width = w * dpr), (cv.height = h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext("2d"));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const x1 = Math.min(...fr.map(([, f]) => f.x)) - 40, y1 = Math.min(...fr.map(([, f]) => f.y)) - 40;
  const x2 = Math.max(...fr.map(([, f]) => f.x + f.w)) + 40, y2 = Math.max(...fr.map(([, f]) => f.y + f.h)) + 40;
  const s = Math.min(w / (x2 - x1), h / (y2 - y1)), ox = (w - (x2 - x1) * s) / 2, oy = (h - (y2 - y1) * s) / 2;
  mapGeom = { x1, y1, s, ox, oy };
  const X = (/** @type {number} */ x) => ox + (x - x1) * s, Y = (/** @type {number} */ y) => oy + (y - y1) * s;
  const css = getComputedStyle(viewport);
  const col = (/** @type {string} */ v) => css.getPropertyValue(v).trim();
  mapFrames = fr.map(([id, f]) => [id, { x: X(f.x), y: Y(f.y), w: f.w * s, h: f.h * s }]);
  for (const [id, r] of mapFrames) {
    const sum = summaries.get(id);
    g.globalAlpha = sum?.dormant ? 0.45 : 1;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 3);
    g.fillStyle = col("--island");
    g.fill();
    g.globalAlpha = 1;
  }
  // the places that need the user, at their real position — the same summary as the atlas level, drawn small
  g.fillStyle = col("--waiting");
  for (const sum of summaries.values())
    for (const p of sum.places) {
      g.beginPath();
      g.arc(X(p.x), Y(p.y), 2.2, 0, 7);
      g.fill();
    }
  // the view as a cut-out: everything outside it is darkened a little
  const rx = X(vx1), ry = Y(vy1), rw = vw * s, rh = vh * s;
  g.beginPath();
  g.rect(0, 0, w, h);
  g.rect(rx + rw, ry, -rw, rh); // reverse winding cuts the view out
  g.fillStyle = col("--text");
  g.globalAlpha = 0.08;
  g.fill("evenodd");
  g.globalAlpha = 1;
}
/** world point under a minimap point @param {number} mx @param {number} my */
export const minimapToWorld = (mx, my) => ({ x: mapGeom.x1 + (mx - mapGeom.ox) / mapGeom.s, y: mapGeom.y1 + (my - mapGeom.oy) / mapGeom.s });
/** island name under a minimap point, for the hover title @param {number} mx @param {number} my */
export const minimapNameAt = (mx, my) => {
  const hit = mapFrames.find(([, r]) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
  return hit ? store.workspaceName(hit[0]) : "";
};
