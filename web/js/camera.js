// @ts-check
// Camera rules (ADR-0012 "Camera", docs/design/canvas.md). Pure: no DOM, unit-tested in test/camera.test.ts.
// A view maps world to screen: screen = world * k + (x, y).

/** @typedef {{ x: number, y: number, k: number }} View */

export const ZOOM = { min: 0.15, max: 3 };
/** zoom of the three levels behind the zoom dots: far is "show everything" (computed), middle and near are fixed */
export const LEVEL_K = { far: 0.7, middle: 1, near: 1.8 };

/** Zoom by `factor` around the screen point (cx, cy), keeping that point fixed. @param {View} v @param {number} factor @param {number} cx @param {number} cy @returns {View} */
export function zoomAt(v, factor, cx, cy) {
  const k = Math.min(ZOOM.max, Math.max(ZOOM.min, v.k * factor));
  return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
}

/** Pan by screen pixels. @param {View} v @param {number} dx @param {number} dy @returns {View} */
export const pan = (v, dx, dy) => ({ ...v, x: v.x + dx, y: v.y + dy });

/**
 * Fit a world box into a screen of W×H. Used only on explicit request and on the very first start.
 * `top` screen pixels at the top are taken (a notice there, onboarding.md "Look"): the box fits into the rest.
 * @param {{ x1: number, y1: number, x2: number, y2: number } | null} b @param {number} W @param {number} H @returns {View}
 */
export function fit(b, W, H, pad = 70, minK = ZOOM.min, top = 0) {
  if (!b) return { x: 60, y: 120 + top, k: 1 };
  const h = H - top;
  const k = Math.min(1, Math.max(minK, Math.min((W - 2 * pad) / (b.x2 - b.x1), (h - 2 * pad) / (b.y2 - b.y1))));
  // a box larger than the screen at this zoom shows its top left, like the start of a page (ADR-0033)
  const x = (b.x2 - b.x1) * k > W - 2 * pad ? pad - b.x1 * k : (W - (b.x2 - b.x1) * k) / 2 - b.x1 * k;
  return { k, x, y: top + Math.max(pad, (h - (b.y2 - b.y1) * k) / 2) - b.y1 * k };
}

/** Size of dots and names relative to the screen: 1 down to the far level, then shrinking with the zoom (ADR-0033). @param {number} k */
export const glyphScale = (k) => Math.min(1, k / LEVEL_K.far);

/**
 * The smallest pan that brings a world box into view with `margin` screen pixels around it — never a zoom change,
 * never a re-centre. Returns the same view object when nothing has to move.
 * @param {View} v @param {{ x: number, y: number, w: number, h: number }} box world @param {number} W @param {number} H @returns {View}
 */
export function reveal(v, box, W, H, margin = 48) {
  const sx1 = box.x * v.k + v.x, sy1 = box.y * v.k + v.y, sx2 = sx1 + box.w * v.k, sy2 = sy1 + box.h * v.k;
  const mx = Math.min(margin, W / 3), my = Math.min(margin, H / 3);
  // if the box is wider/taller than the room, align its start
  const dx = sx1 < mx ? mx - sx1 : sx2 > W - mx ? Math.max(mx - sx1, W - mx - sx2) : 0;
  const dy = sy1 < my ? my - sy1 : sy2 > H - my ? Math.max(my - sy1, H - my - sy2) : 0;
  return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
}
