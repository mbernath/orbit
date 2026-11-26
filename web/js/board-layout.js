// @ts-check
// Applies placement.js to the DOM: collects dots, frames and obstacles in screen space, measures names and bubbles,
// writes depth, sides and corners back, draws edge hints and triggers the minimap (minimap-canvas.js). All decisions live in placement.js.
import { drawAtlas, summaries } from "./atlas-view.js";
import { glyphScale } from "./camera.js";
import { measureCopy } from "./measure.js";
import { drawMinimap } from "./minimap-canvas.js";
import { baseDepth, place } from "./placement.js";
import { boxOf, currentFrames, elementNode, viewOf } from "./render.js";
import { store } from "./store.js";
import { esc } from "./util.js";
import { isDone, prOf } from "./views/pr.js";

/** @typedef {import("./placement.js").Rect} Rect */
/** @typedef {import("./camera.js").View} View */

/** @type {Map<string, import("./placement.js").Sticky>} */
let sticky = new Map();
/** the current click target of the edge hints (hints are kept across passes; their handler reads this) */
let onHint = (/** @type {string} */ _id) => {};

/** @param {HTMLElement} n @param {string} k @param {string} v */
const setData = (n, k, v) => n.dataset[k] !== v && (n.dataset[k] = v);
/** @param {HTMLElement} n @param {string} prop @param {string} v */
const setStyle = (n, prop, v) => n.style.getPropertyValue(prop) !== v && n.style.setProperty(prop, v);

/** what the user works with (ADR-0012): hover, keyboard focus; fresh events for 10 s */
export const attention = {
  /** @type {string | null} */ hover: null,
  /** @type {string | null} the one active island (hover.js) */ island: null,
  /** @type {string | null} */ focus: null,
  /** @type {Map<string, number>} ref -> time the event arrived */ fresh: new Map(),
};
export const FRESH_MS = 10_000;

/** Needs the user: the session itself, its PR (red CI, mergeable) or, when Orbit runs it, an open question. @param {import("./store.js").Entity} e */
export const needsUser = (e) =>
  !isDone(e) && (!!e.attention || !!prOf(e)?.needs || store.related(e, "control").some((c) => !!c.attention)); // done work never calls (ADR-0023)
/** reason shown in an edge hint @param {import("./store.js").Entity} e */
const reason = (e) =>
  e.attention?.text ?? store.related(e, "control").find((c) => c.attention)?.attention?.text ?? (prOf(e)?.needs ? prOf(e)?.pr.attention?.text : null) ?? "";

/**
 * @param {{ viewport: HTMLElement, view: View, onHint: (ref: string) => void, onIsland: (id: string) => void, onElement: (ref: string) => void }} ctx
 */
export function layoutBoard(ctx) {
  const { viewport, view } = ctx;
  const vr = viewport.getBoundingClientRect();
  const W = vr.width, H = vr.height;
  const g = glyphScale(view.k); // placement works in screen px, the glyph layer in px scaled by g (ADR-0033)
  const toScreen = (/** @type {number} */ x, /** @type {number} */ y) => ({ x: x * view.k + view.x, y: y * view.k + view.y });
  const rel = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height };
  };
  const now = Date.now();

  /** @type {import("./placement.js").Item[]} */
  const items = [];
  /** hovered or focused: drawn lifted (enlarged dot) even where the bubble gives way */
  const lifted = new Set([attention.hover, attention.focus].filter(Boolean));
  /** @type {Rect[]} */
  const obstacles = [];
  for (const e of store.entities) {
    const node = elementNode(e.ref);
    const b = boxOf(e.ref);
    const v = viewOf(e.ref);
    if (!node || !b || !v) continue;
    if (!v.anchor || !v.bubbleAt) {
      obstacles.push(rel(node)); // views without a glyph (none today) would be fixed cards
      continue;
    }
    const bubble = v.bubbleAt;
    const p = toScreen(b.x + v.anchor.x, b.y + v.anchor.y);
    const fresh = (attention.fresh.get(e.ref) ?? 0) > now - FRESH_MS;
    items.push({
      id: e.ref,
      island: b.island,
      x: p.x,
      y: p.y,
      prio: v.prio?.(e) ?? 0,
      asks: v.asks?.(e) ?? false,
      // only the pointer makes a bubble an overlay; focus (panel, keyboard) lifts the depth but the bubble still gives way
      attn: e.ref === attention.hover ? 2 : e.ref === attention.focus || fresh ? 1 : 0,
      bubbleAt: (d) => bubble(e, d),
    });
  }
  // island names: frames are fixed (ADR-0012), so their names can be obstacles without any feedback loop
  for (const head of viewport.querySelectorAll(".frame-head")) obstacles.push(rel(head));

  /** @type {Map<string, Rect>} */
  const frames = new Map([...currentFrames()].map(([id, f]) => {
    const p = toScreen(f.x, f.y);
    return [id, { x: p.x, y: p.y, w: f.w * view.k, h: f.h * view.k }];
  }));
  const chrome = [...viewport.querySelectorAll(".chrome, .minimap")].map(rel);

  /** name and bubble size of an element at a depth — measured on an invisible copy, never on what the user sees */
  const measure = (/** @type {string} */ id, /** @type {number} */ depth) => {
    const node = /** @type {HTMLElement} */ (elementNode(id));
    const hasBubble = !!viewOf(id)?.bubbleAt?.(/** @type {any} */ (store.byRef.get(id)), depth);
    const size = measureCopy(viewport, node, depth);
    return { lab: size.lab, bub: hasBubble ? size.bub : null };
  };

  // edge hints for sessions that need the user and lie outside the view
  // edge hints are kept by id across passes and only updated, never rebuilt (rebuilding made them blink)
  const edgeBox = /** @type {HTMLElement} */ (viewport.querySelector(".edges"));
  onHint = ctx.onHint;
  /** @type {Map<string, HTMLElement>} */
  const pills = new Map();
  const targets = [];
  for (const it of items) {
    const e = store.byRef.get(it.id);
    if (!e || !needsUser(e) || (it.x > 12 && it.x < W - 12 && it.y > 12 && it.y < H - 12)) continue;
    let pill = /** @type {HTMLElement | null} */ (edgeBox.querySelector(`[data-hint="${CSS.escape(it.id)}"]`));
    if (!pill) {
      pill = document.createElement("button");
      pill.className = "edge";
      pill.dataset.hint = it.id;
      const id = it.id;
      pill.addEventListener("pointerdown", (ev) => (ev.stopPropagation(), ev.preventDefault(), onHint(id)));
      pill.addEventListener("keydown", (ev) => ev.key === "Enter" && onHint(id));
      edgeBox.append(pill);
    }
    const html = `<i></i><span><b>${esc(store.workspaceName(it.island))}</b> ${esc(e.title)}</span><em>${esc(reason(e))}</em>`;
    if (pill.dataset.html !== html) (pill.innerHTML = html), (pill.dataset.html = html);
    pills.set(it.id, pill);
    targets.push({ id: it.id, x: it.x, y: it.y });
  }
  for (const old of edgeBox.querySelectorAll("[data-hint]")) if (!pills.has(/** @type {HTMLElement} */ (old).dataset.hint ?? "")) old.remove();

  const result = place({
    items, frames, W, H, base: baseDepth(view.k), measure, chrome, obstacles, links: [], sticky, g,
    hints: { items: targets, size: (id) => ({ w: /** @type {HTMLElement} */ (pills.get(id)).offsetWidth, h: /** @type {HTMLElement} */ (pills.get(id)).offsetHeight }) },
  });
  sticky = result.sticky;

  // apply: this module owns depth, side, corner and the classes sl/sb/prio/fresh; it writes only what changed,
  // so a layout pass that decides the same as before leaves the DOM (and every CSS transition) untouched
  for (const it of items) {
    const node = /** @type {HTMLElement} */ (elementNode(it.id));
    const pl = result.placed.get(it.id);
    if (!pl) continue;
    setData(node, "depth", String(pl.depth));
    node.classList.toggle("prio", lifted.has(it.id)); // hovered or focused: looks lifted either way
    node.classList.toggle("fresh", it.attn === 1);
    const lab = /** @type {HTMLElement} */ (node.querySelector(".lab"));
    const bub = /** @type {HTMLElement} */ (node.querySelector(".bub"));
    node.classList.toggle("sl", !!pl.lab);
    if (pl.lab) {
      setData(lab, "side", pl.lab.side);
      const full = measureCopy(viewport, node, pl.depth).lab.w;
      setStyle(lab, "max-width", pl.lab.w < full * g ? `${pl.lab.w / g}px` : "");
    }
    node.classList.toggle("sb", !!pl.bub);
    if (pl.bub) {
      setData(bub, "corner", pl.bub.corner);
      // slid into its island (slidRect), or past its name and centred on the dot (bubble-place.js besideSpot)
      const dy = pl.bub.corner === "e" ? "-50%" : "0";
      setStyle(bub, "translate", pl.bub.shift || dy !== "0" ? `${pl.bub.shift / g}px ${dy}` : "");
    }
  }

  const placedHints = new Set(result.hints.map((h) => h.id));
  for (const [id, pill] of pills) {
    if (!placedHints.has(id)) pill.remove();
  }
  for (const h of result.hints) {
    const pill = /** @type {HTMLElement} */ (pills.get(h.id));
    setStyle(pill, "left", `${h.x}px`);
    setStyle(pill, "top", `${h.y}px`);
    setStyle(/** @type {HTMLElement} */ (pill.querySelector("i")), "transform", `rotate(${h.angle.toFixed(3)}rad)`);
  }

  const atlas = drawAtlas({ viewport, view, g, needsUser, onIsland: ctx.onIsland, onElement: ctx.onElement });
  drawMinimap(viewport, view, W, H, atlas, summaries);
  return { level: baseDepth(view.k) };
}
