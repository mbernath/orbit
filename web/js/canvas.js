// @ts-check
// Infinite canvas: camera (pan, zoom) and pointer interactions — drag an element, move or resize an island.
// Knows nothing about entities; geometry rules come from camera.js and frames.js.
import { snap } from "./arrange.js";
import * as cam from "./camera.js";
import { moveFrame, resizeFrame } from "./frames.js";
import { closest, prefs } from "./util.js";

/** @typedef {import("./frames.js").Box} Box */

/**
 * @param {{
 *   viewport: HTMLElement, world: HTMLElement,
 *   frames: () => Map<string, Box>,
 *   content: (island: string) => { id: string, box: Box, node: HTMLElement | undefined }[],
 *   frameNode: (island: string) => HTMLElement | undefined,
 *   onPlace: (id: string, x: number, y: number) => void,
 *   selected: () => string[],
 *   onToggleSelect: (id: string) => void,
 *   onLasso: (rect: { x1: number, y1: number, x2: number, y2: number }) => void,
 *   onGroupMove: (ids: string[], dx: number, dy: number) => void,
 *   onFrameMove: (island: string, frame: Box, moves: { ref: string, x: number, y: number }[]) => void,
 *   onFrameResize: (island: string, frame: Box) => void,
 *   onBackgroundClick?: (worldX: number, worldY: number) => void,
 *   onElementClick?: (id: string) => void,
 *   onFrameClick?: (island: string) => void,
 *   onViewChange?: (view: cam.View) => void,
 * }} opts
 */
export function createCanvas(opts) {
  const { viewport, world } = opts;
  /** @type {cam.View} */
  let view = (() => {
    try {
      return JSON.parse(prefs.get("view") ?? "") ?? null;
    } catch {
      return null;
    }
  })() ?? { x: 60, y: 120, k: 1 };
  const hadView = !!prefs.get("view");

  /** @type {null | { kind: "pan", sx: number, sy: number, start: cam.View, moved: boolean }
   *  | { kind: "element", el: HTMLElement, id: string, sx: number, sy: number, ox: number, oy: number, moved: boolean }
   *  | { kind: "group", id: string, sx: number, sy: number, ox: number, oy: number, items: { id: string, node: HTMLElement, ox: number, oy: number }[], moved: boolean }
   *  | { kind: "lasso", sx: number, sy: number, box: HTMLElement, moved: boolean }
   *  | { kind: "frame", island: string, node: HTMLElement, sx: number, sy: number, start: Box, last: Box, items: { id: string, node: HTMLElement | undefined, ox: number, oy: number }[], moved: boolean }
   *  | { kind: "resize", island: string, node: HTMLElement, sx: number, sy: number, start: Box, last: Box, content: Box[], moved: boolean }} */
  let drag = null;

  function apply() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    // glyphs keep their screen size down to the far level, then shrink with the zoom; bubbles undo it (ADR-0033)
    const g = cam.glyphScale(view.k);
    world.style.setProperty("--inv", String(g / view.k));
    world.style.setProperty("--ug", String(1 / g));
    prefs.set("view", JSON.stringify(view));
    opts.onViewChange?.(view);
  }
  /** @param {cam.View} v */
  const set = (v) => {
    if (v === view) return;
    view = v;
    apply();
  };
  const size = () => viewport.getBoundingClientRect();
  /**
   * A camera step that depends on the board's size, run only while the board is shown: in the panel's full mode
   * it is display:none and measures 0×0, which would throw the camera off (e.g. reveal pans the glyph to 0,0).
   * @param {(W: number, H: number) => cam.View} step
   */
  const sized = (step) => {
    const { width: W, height: H } = size();
    if (W && H) set(step(W, H));
  };
  /** screen pixels at the top taken by visible notices (`data-inset="top"`), which a fit must not cover */
  const topInset = () => {
    const top = size().top;
    let inset = 0;
    for (const n of viewport.querySelectorAll('[data-inset="top"]:not([hidden])')) inset = Math.max(inset, n.getBoundingClientRect().bottom - top);
    return inset;
  };
  /** @param {PointerEvent} e */
  const toWorld = (e) => {
    const r = size();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || closest(e.target, "button, input, textarea, a, select, .toast, .chrome, .menu, .minimap, .edges, [data-editing], .no-drag")) return;
    const base = { sx: e.clientX, sy: e.clientY, moved: false };
    const resize = closest(e.target, "[data-frame-resize]");
    const head = closest(e.target, "[data-frame-move]");
    const el = closest(e.target, "[data-element]");
    if (resize || head) {
      const island = (resize ?? head)?.dataset.frameResize ?? head?.dataset.frameMove ?? "";
      const node = opts.frameNode(island);
      const start = opts.frames().get(island);
      if (!node || !start) return;
      node.dataset.dragging = "1";
      drag = resize
        ? { kind: "resize", island, node, start, last: start, content: opts.content(island).map((c) => c.box), ...base }
        : { kind: "frame", island, node, start, last: start, items: opts.content(island).map((c) => ({ id: c.id, node: c.node, ox: c.box.x, oy: c.box.y })), ...base };
    } else if (el && e.shiftKey) {
      opts.onToggleSelect(el.dataset.element ?? ""); // ⇧ + click toggles, never drags (ADR-0034)
      return;
    } else if (el) {
      const id = el.dataset.element ?? "";
      const pos = (/** @type {HTMLElement} */ n) => ({ ox: parseFloat(n.style.left), oy: parseFloat(n.style.top) });
      const group = opts.selected();
      if (group.length > 1 && group.includes(id)) {
        const items = group.flatMap((g) => {
          const node = /** @type {HTMLElement | null} */ (world.querySelector(`[data-element="${CSS.escape(g)}"]`));
          return node ? [{ id: g, node, ...pos(node) }] : [];
        });
        drag = { kind: "group", id, items, ...pos(el), ...base };
      } else drag = { kind: "element", el, id, ...pos(el), ...base };
    } else if (e.shiftKey) {
      const box = document.createElement("div");
      box.className = "lasso";
      box.hidden = true;
      viewport.appendChild(box);
      drag = { kind: "lasso", box, ...base };
    } else {
      drag = { kind: "pan", start: view, ...base };
      viewport.classList.add("panning");
    }
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const sdx = e.clientX - drag.sx, sdy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(sdx, sdy) < 4) return;
    drag.moved = true;
    const dx = sdx / view.k, dy = sdy / view.k;
    if (drag.kind === "pan") return set(cam.pan(drag.start, sdx, sdy));
    if (drag.kind === "element") {
      drag.el.classList.add("dragging");
      drag.el.style.left = `${drag.ox + dx}px`;
      drag.el.style.top = `${drag.oy + dy}px`;
      return;
    }
    if (drag.kind === "group") {
      for (const it of drag.items) {
        it.node.classList.add("dragging");
        Object.assign(it.node.style, { left: `${it.ox + dx}px`, top: `${it.oy + dy}px` });
      }
      return;
    }
    if (drag.kind === "lasso") {
      const r = size();
      Object.assign(drag.box.style, {
        left: `${Math.min(drag.sx, e.clientX) - r.left}px`, top: `${Math.min(drag.sy, e.clientY) - r.top}px`,
        width: `${Math.abs(sdx)}px`, height: `${Math.abs(sdy)}px`,
      });
      drag.box.hidden = false;
      return;
    }
    if (drag.kind === "frame") {
      const f = moveFrame(opts.frames(), drag.island, drag.start, dx, dy);
      drag.last = f;
      place(drag.node, f);
      const mx = f.x - drag.start.x, my = f.y - drag.start.y;
      for (const it of drag.items) if (it.node) Object.assign(it.node.style, { left: `${it.ox + mx}px`, top: `${it.oy + my}px` });
      return;
    }
    const f = resizeFrame(opts.frames(), drag.island, drag.start, dx, dy, drag.content);
    drag.last = f;
    place(drag.node, f);
  });

  const end = (/** @type {PointerEvent} */ e) => {
    viewport.classList.remove("panning");
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "pan") {
      if (!d.moved && e.type === "pointerup") opts.onBackgroundClick?.(toWorld(e).x, toWorld(e).y);
      return;
    }
    // drops snap the dragged dot to the grid; ⌥ turns it off (ADR-0034)
    const grid = (/** @type {number} */ v) => (e.altKey ? Math.round(v) : snap(v));
    if (d.kind === "element") {
      d.el.classList.remove("dragging");
      if (d.moved) opts.onPlace(d.id, grid(parseFloat(d.el.style.left)), grid(parseFloat(d.el.style.top)));
      else if (e.type === "pointerup") opts.onElementClick?.(d.id);
      return;
    }
    if (d.kind === "group") {
      for (const it of d.items) it.node.classList.remove("dragging");
      if (!d.moved) return void (e.type === "pointerup" && opts.onElementClick?.(d.id));
      const lead = d.items.find((it) => it.id === d.id);
      const x = lead ? parseFloat(lead.node.style.left) : d.ox, y = lead ? parseFloat(lead.node.style.top) : d.oy;
      opts.onGroupMove(d.items.map((it) => it.id), grid(x) - d.ox, grid(y) - d.oy);
      return;
    }
    if (d.kind === "lasso") {
      d.box.remove();
      if (d.moved) {
        const r = size(), w = (/** @type {number} */ cx, /** @type {number} */ cy) => ({ x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k });
        const a = w(d.sx, d.sy), b = w(e.clientX, e.clientY);
        opts.onLasso({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      return;
    }
    delete d.node.dataset.dragging;
    if (!d.moved) return void (d.kind === "frame" && e.type === "pointerup" && opts.onFrameClick?.(d.island)); // a click on the name

    const f = { x: Math.round(d.last.x), y: Math.round(d.last.y), w: Math.round(d.last.w), h: Math.round(d.last.h) };
    if (d.kind === "frame") {
      const mx = f.x - d.start.x, my = f.y - d.start.y;
      opts.onFrameMove(d.island, f, d.items.map((it) => ({ ref: it.id, x: Math.round(it.ox + mx), y: Math.round(it.oy + my) })));
    } else opts.onFrameResize(d.island, f);
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);

  // Trackpad: two-finger swipe pans, pinch (ctrl + wheel) zooms. Mouse: wheel pans, ⌘/Ctrl + wheel zooms.
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (closest(e.target, ".chrome, .menu")) return;
      if (!e.ctrlKey && !e.metaKey && closest(e.target, ".scrollable, textarea")) return; // scrollable content scrolls itself
      e.preventDefault();
      const r = size();
      if ((e.ctrlKey || e.metaKey) && viewport.classList.contains("first-run-on")) return; // first run: no zoom (onboarding.md)
      if (e.ctrlKey || e.metaKey) set(cam.zoomAt(view, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
      else set(cam.pan(view, -e.deltaX, -e.deltaY));
    },
    { passive: false },
  );

  apply();
  return {
    /** Zoom around the centre of the board (explicit zoom input only). @param {number} factor */
    zoom: (factor) => sized((W, H) => cam.zoomAt(view, factor, W / 2, H / 2)),
    /** Set the zoom to k around the board centre (zoom dots, + / −). @param {number} k */
    zoomTo: (k) => sized((W, H) => cam.zoomAt(view, k / view.k, W / 2, H / 2)),
    /** Pan so the world point is at the board centre (minimap). @param {number} x @param {number} y */
    centerOn: (x, y) => sized((W, H) => ({ ...view, x: W / 2 - x * view.k, y: H / 2 - y * view.k })),
    /** Pan by screen pixels (arrow keys). @param {number} dx @param {number} dy */
    panBy: (dx, dy) => set(cam.pan(view, dx, dy)),
    /** @param {{ x1: number, y1: number, x2: number, y2: number } | null} b */
    fit: (b) => sized((W, H) => cam.fit(b, W, H, 70, cam.ZOOM.min, topInset())),
    /** The first start: fit, but never zoomed out beyond the far level (ADR-0033). @param {Parameters<typeof cam.fit>[0]} b */
    fitStart: (b) => sized((W, H) => cam.fit(b, W, H, 70, cam.LEVEL_K.far, topInset())),
    /** Smallest pan that shows a world box; never zooms. @param {Box} box @param {number} [margin] */
    reveal: (box, margin) => sized((W, H) => cam.reveal(view, box, W, H, margin)),
    /** True while the element is being dragged; the renderer must not move it. @param {string} id */
    isDragging: (id) =>
      (drag?.kind === "element" && drag.id === id && drag.moved) ||
      ((drag?.kind === "frame" || drag?.kind === "group") && drag.moved && drag.items.some((i) => i.id === id)),
    view: () => view,
    hadView,
  };
}

/** @param {HTMLElement} node @param {Box} f */
function place(node, f) {
  Object.assign(node.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
}
