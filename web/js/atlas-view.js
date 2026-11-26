// @ts-check
// Draws the atlas level (ADR-0037): one tile per island over its frame, in screen space — the island name top left and
// the places that need the user as orange glyphs at their real position. Decisions live in atlas.js.
// A tile takes the pointer so it can be hovered and clicked; a press that moves pans the board as usual (canvas.js).
import { fitName, isAtlas, NAME_PX, nameSpot, summarise } from "./atlas.js";
import { boxOf, currentFrames, viewOf } from "./render.js";
import { store } from "./store.js";
import { esc } from "./util.js";

/** @typedef {import("./camera.js").View} View */
/** @typedef {import("./atlas.js").Summary} Summary */

/** @type {Map<string, Summary>} last summaries, also drawn by the minimap */
export let summaries = new Map();
let wired = false;

/** @param {import("./store.js").Entity} e */
const working = (e) => e.status === "working" || store.related(e, "control").some((c) => c.status === "working");

/**
 * @param {{ viewport: HTMLElement, view: View, g: number, needsUser: (e: import("./store.js").Entity) => boolean,
 *   onIsland: (id: string) => void, onElement: (ref: string) => void }} ctx
 * @returns {boolean} whether the atlas level is shown
 */
export function drawAtlas(ctx) {
  const { viewport, view } = ctx;
  const layer = /** @type {HTMLElement} */ (viewport.querySelector(".atlas"));
  const frames = currentFrames();
  /** @type {import("./atlas.js").AtlasItem[]} */
  const items = [];
  for (const e of store.entities) {
    const b = boxOf(e.ref), a = viewOf(e.ref)?.anchor;
    if (!b || !a) continue;
    const needs = ctx.needsUser(e);
    items.push({ ref: e.ref, island: b.island, x: b.x + a.x, y: b.y + a.y, needs, ring: e.attention?.level === "done",
      active: needs || working(e), updatedAt: e.updatedAt ?? 0 });
  }
  summaries = summarise([...frames.keys()], items, Date.now());
  const on = isAtlas(ctx.g);
  viewport.classList.toggle("atlas-on", on);
  if (!on) return (layer.replaceChildren(), false);
  if (!wired) wire(layer, ctx), (wired = true);

  const cv = document.createElement("canvas").getContext("2d");
  const css = getComputedStyle(layer);
  const spacing = 0.12 * NAME_PX; // letter-spacing of .a-name (style.css)
  const measure = (/** @type {string} */ t) => {
    if (!cv) return t.length * NAME_PX * 0.8;
    cv.font = `500 ${NAME_PX}px ${css.fontFamily}`;
    return cv.measureText(t.toUpperCase()).width + t.length * spacing;
  };
  const keep = new Set();
  for (const [id, f] of frames) {
    keep.add(id);
    const s = /** @type {Summary} */ (summaries.get(id));
    const x = f.x * view.k + view.x, y = f.y * view.k + view.y, w = f.w * view.k, h = f.h * view.k;
    const name = store.workspaceName(id);
    const places = s.places.map((p) => ({ ...p, sx: (p.x - f.x) * view.k, sy: (p.y - f.y) * view.k }));
    const lines = fitName(name, w, h, measure);
    const spot = lines && nameSpot(lines, w, h, measure, places.map((p) => ({ x: p.sx, y: p.sy })));
    const html =
      (lines && spot ? `<div class="a-name" style="left:${spot.x}px;top:${spot.y}px">${lines.map(esc).join("<br>")}</div>` : `<div class="a-more">${esc(name)}</div>`) +
      places.map((p) => `<i class="a-place${p.ring ? " ring" : ""}" data-atlas-ref="${esc(p.ref)}" style="left:${p.sx}px;top:${p.sy}px"></i>`).join("");
    let tile = /** @type {HTMLElement | null} */ (layer.querySelector(`[data-atlas="${CSS.escape(id)}"]`));
    if (!tile) {
      tile = document.createElement("div");
      tile.dataset.atlas = id;
      layer.append(tile);
    }
    const cls = `atlas-isle${s.dormant ? " dormant" : ""}`;
    if (tile.className !== cls) tile.className = cls;
    if (tile.dataset.html !== html) (tile.innerHTML = html), (tile.dataset.html = html);
    tile.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.max(6, 28 * view.k)}px`;
  }
  for (const t of layer.querySelectorAll("[data-atlas]")) if (!keep.has(/** @type {HTMLElement} */ (t).dataset.atlas)) t.remove();
  return true;
}

/** a press that does not move is a click: island → show it, place → go to that element @param {HTMLElement} layer */
function wire(layer, /** @type {Parameters<typeof drawAtlas>[0]} */ ctx) {
  /** @type {{ x: number, y: number, island: string, ref: string } | null} */
  let press = null;
  layer.addEventListener("pointerdown", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const tile = /** @type {HTMLElement | null} */ (t.closest("[data-atlas]"));
    if (!tile || ev.button !== 0) return;
    press = { x: ev.clientX, y: ev.clientY, island: tile.dataset.atlas ?? "", ref: /** @type {HTMLElement | null} */ (t.closest("[data-atlas-ref]"))?.dataset.atlasRef ?? "" };
  });
  window.addEventListener("pointerup", (ev) => {
    const p = press;
    press = null;
    if (!p || Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 4) return;
    if (p.ref) ctx.onElement(p.ref);
    else ctx.onIsland(p.island);
  });
}
