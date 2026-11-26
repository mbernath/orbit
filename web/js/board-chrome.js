// @ts-check
// The board's chrome and screen geometry: zoom dots (far shows everything, middle and near have fixed zoom), the
// minimap (press and drag moves the view, names on hover, ADR-0037), and which island lies at a screen point or
// takes the most room on screen. Split from main.js (debt #44).
import { LEVEL_K } from "./camera.js";
import { minimapNameAt, minimapToWorld } from "./minimap-canvas.js";
import { currentFrames, worldBounds } from "./render.js";

/** @param {{ viewport: HTMLElement, canvas: ReturnType<typeof import("./canvas.js").createCanvas> }} o */
export function installChrome({ viewport, canvas }) {
  /** @param {number} level 0 far, 1 middle, 2 near */
  function toLevel(level) {
    if (level <= 0) {
      // far: everything in view, but never closer than the far level itself
      canvas.fit(worldBounds());
      if (canvas.view().k > LEVEL_K.far) canvas.zoomTo(LEVEL_K.far);
      return;
    }
    canvas.zoomTo(level === 1 ? LEVEL_K.middle : LEVEL_K.near);
  }
  document.querySelectorAll(".zd").forEach((b) => b.addEventListener("click", () => toLevel(Number(/** @type {HTMLElement} */ (b).dataset.level))));
  const currentLevel = () => Number(/** @type {HTMLElement | null} */ (document.querySelector(".zd.on"))?.dataset.level ?? 1);

  const mini = /** @type {HTMLElement} */ (viewport.querySelector(".minimap"));
  let miniDrag = false;
  const miniMove = (/** @type {PointerEvent} */ e) => {
    const r = mini.getBoundingClientRect();
    const p = minimapToWorld(e.clientX - r.left, e.clientY - r.top);
    canvas.centerOn(p.x, p.y);
  };
  mini.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    miniDrag = true;
    mini.setPointerCapture(e.pointerId);
    miniMove(e);
  });
  mini.addEventListener("pointermove", (e) => {
    if (miniDrag) return miniMove(e);
    const r = mini.getBoundingClientRect();
    mini.title = minimapNameAt(e.clientX - r.left, e.clientY - r.top); // names only on hover (ADR-0037)
  });
  mini.addEventListener("pointerup", () => (miniDrag = false));

  /** the island at a screen point, by geometry (frames take pointer events only at their name) @param {number} cx @param {number} cy */
  function islandAt(cx, cy) {
    const v = canvas.view();
    const r = viewport.getBoundingClientRect();
    const x = (cx - r.left - v.x) / v.k, y = (cy - r.top - v.y) / v.k;
    return [...currentFrames()].find(([, f]) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h)?.[0] ?? null;
  }
  /** the island taking the most room on screen @returns {string | null} */
  function mostVisibleIsland() {
    const v = canvas.view();
    const r = viewport.getBoundingClientRect();
    const sx = -v.x / v.k, sy = -v.y / v.k, sw = r.width / v.k, sh = r.height / v.k;
    let best = null, area = 0;
    for (const [id, f] of currentFrames()) {
      const a = Math.max(0, Math.min(f.x + f.w, sx + sw) - Math.max(f.x, sx)) * Math.max(0, Math.min(f.y + f.h, sy + sh) - Math.max(f.y, sy));
      if (a > area) (best = id), (area = a);
    }
    return best;
  }

  return { toLevel, currentLevel, islandAt, mostVisibleIsland };
}
