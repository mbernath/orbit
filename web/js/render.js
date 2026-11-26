// @ts-check
// Renders islands (frames) and entities (elements) on the canvas (ADR-0008, ADR-0012).
// Geometry comes from the pure frames.js; this module only writes DOM, keyed so drags and edits survive updates.
import { layoutIslands } from "./island-layout.js";
import { rememberSlots, slotMemory } from "./slots.js";
import { orphanPrs, sessionPrs } from "./orphan-prs.js";
import { prStack } from "./pr-stack.js";
import { store } from "./store.js";
import { migrateLayout } from "./tidy-once.js";
import { esc } from "./util.js";
import { viewFor } from "./views/registry.js";

/** @typedef {import("./store.js").Entity} Entity */
/** @typedef {import("./views/registry.js").View} View */
/** @typedef {import("./frames.js").Box} Box */

/** @type {Map<string, { node: HTMLElement, view: View }>} */
const nodes = new Map(); // element id -> DOM node and the view that owns it
/** @type {Map<string, HTMLElement>} */
const frameNodes = new Map(); // island id -> frame node
/** @type {Map<string, Box & { island: string }>} */
let boxes = new Map(); // element id -> world box and island
/** @type {Map<string, Box>} */
let frames = new Map(); // island id -> frame as currently shown

/** Stable auto-layout key (ADR-0012): when the entity began, never its last activity. Sessions carry
 * `data.startedAt`; entities without it sort by ref (ties in layoutIslands). @param {{ data: Record<string, unknown> }} e */
const createdAtOf = (e) => (typeof e.data?.startedAt === "number" ? e.data.startedAt : 0);

/** The part of the element box the auto-layout spaces (dot and name), relative to the box. @param {View} view @param {Entity} e */
const slotBox = (view, e) => {
  const s = view.slot?.(e);
  return s && view.anchor ? { x: view.anchor.x - s.x, y: view.anchor.y - s.y, w: s.w, h: s.h } : undefined;
};

/** @type {import("./frames.js").LayoutItem[]} */
let lastItems = []; // as last laid out, for "Tidy island"

/** Entities that have a view and are shown. Entities without a view (e.g. PRs) live inside others. */
export function visibleElements() {
  return store.entities.filter((e) => viewFor(e.kind) && !store.isArchived(e.ref) && !store.isRun(e));
}

/**
 * @param {HTMLElement} world
 * @param {{ isDragging: (id: string) => boolean, editingId: string | null }} ui
 */
export function renderCanvas(world, ui) {
  const islands = store.islands();
  const items = visibleElements().map((e) => {
    const el = store.elements.get(e.ref);
    const view = /** @type {View} */ (viewFor(e.kind, el?.view));
    const size = view.size(e);
    const placed = el && el.x != null && el.y != null ? { x: el.x, y: el.y } : null;
    // rank comes from the view only, never from state: a dot that goes inactive keeps its slot (ADR-0012)
    return { ref: e.ref, island: store.islandOf(e), rank: view.rank ?? 0, createdAt: createdAtOf(e), w: size.w, h: size.h, slot: slotBox(view, e), placed, entity: e, element: el, view };
  });
  migrateLayout(islands, store.storedFrames(), items); // once per browser
  const layout = layoutIslands(islands, store.storedFrames(), items, slotMemory());
  rememberSlots(layout.slots, (ref) => store.byRef.size === 0 || store.byRef.has(ref));
  lastItems = items;
  frames = layout.frames;
  boxes = new Map(items.map((it) => [it.ref, { ...(layout.positions.get(it.ref) ?? { x: 0, y: 0 }), w: it.w, h: it.h, island: it.island }]));

  renderFrames(world, islands);

  const seen = new Set();
  for (const it of items) {
    seen.add(it.ref);
    let entry = nodes.get(it.ref);
    if (entry && entry.view !== it.view) {
      unmount(it.ref); // the element switched to another view
      entry = undefined;
    }
    if (!entry) {
      const node = document.createElement("div");
      node.dataset.element = it.ref;
      world.appendChild(node);
      entry = { node, view: it.view };
      nodes.set(it.ref, entry);
      it.view.mount?.(node, it.entity, it.element);
    }
    const { node, view } = entry;
    if (node.dataset.island !== it.island) node.dataset.island = it.island;
    // the renderer owns only its own classes; placement classes (sl, sb, prio, fresh) belong to board-layout.js
    setOwnClasses(node, `element view-${view.id} kind-${it.entity.kind} ${view.className?.(it.entity) ?? ""}${it.element?.archived ? " archived" : ""}${ui.isDragging(it.ref) ? " dragging" : ""}`);
    setStyle(node, "width", `${it.w}px`);
    setStyle(node, "height", `${it.h}px`);
    if (view.render) {
      if (ui.editingId !== it.ref) setHtml(node, view.render(it.entity, it.element));
    } else {
      view.update?.(node, it.entity, it.element);
    }
    if (!ui.isDragging(it.ref)) {
      const box = boxes.get(it.ref);
      setStyle(node, "left", `${box?.x ?? 0}px`);
      setStyle(node, "top", `${box?.y ?? 0}px`);
    }
  }
  for (const id of [...nodes.keys()]) if (!seen.has(id)) unmount(id);
  return { visible: items.length };
}

/** Writes only what changed, so an unchanged element produces no DOM mutation at all. @param {HTMLElement} node @param {string} prop @param {string} value */
function setStyle(node, prop, value) {
  if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
}
/** Replaces the classes this renderer set last time, leaving every other class alone. @param {HTMLElement} node @param {string} classes */
function setOwnClasses(node, classes) {
  const want = classes.split(/\s+/).filter(Boolean);
  const had = (node.dataset.own ?? "").split(" ").filter(Boolean);
  for (const c of had) if (!want.includes(c)) node.classList.remove(c);
  for (const c of want) if (!node.classList.contains(c)) node.classList.add(c);
  const own = want.join(" ");
  if (node.dataset.own !== own) node.dataset.own = own;
}

/** @param {string} id */
function unmount(id) {
  const entry = nodes.get(id);
  if (!entry) return;
  entry.view.unmount?.(entry.node);
  entry.node.remove();
  nodes.delete(id);
}

/** One frame per island: tinted area, name (drag handle, click opens the island panel), "+" to add, resize corner. @param {HTMLElement} world @param {string[]} islands */
function renderFrames(world, islands) {
  const seen = new Set();
  for (const id of islands) {
    const f = frames.get(id);
    if (!f) continue;
    seen.add(id);
    let node = frameNodes.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "frame";
      node.dataset.frame = id;
      node.innerHTML = `<div class="frame-head" data-frame-move="${esc(id)}"><span class="frame-name"></span><button class="frame-add" data-island-menu="${esc(id)}" aria-label="Add to island"></button><span class="frame-prs"></span></div><div class="frame-grip" data-frame-resize="${esc(id)}"></div>`;
      world.prepend(node);
      frameNodes.set(id, node);
    }
    const name = /** @type {HTMLElement} */ (node.querySelector(".frame-name"));
    if (name.textContent !== store.workspaceName(id)) name.textContent = store.workspaceName(id);
    setHtml(/** @type {HTMLElement} */ (node.querySelector(".frame-prs")), prPill(id));
    if (node.dataset.dragging) continue; // the interaction owns its geometry until it ends
    setStyle(node, "left", `${f.x}px`);
    setStyle(node, "top", `${f.y}px`);
    setStyle(node, "width", `${f.w}px`);
    setStyle(node, "height", `${f.h}px`);
  }
  for (const [id, node] of frameNodes) {
    if (seen.has(id)) continue;
    node.remove();
    frameNodes.delete(id);
  }
}

/** Avoids DOM churn: only touch innerHTML when the markup changed. @param {HTMLElement} node @param {string} html */
function setHtml(node, html) {
  const h = String(hash(html));
  if (node.dataset.html === h) return;
  node.innerHTML = html;
  node.dataset.html = h;
}
/** @param {string} s */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Layout items of the last render (for "Tidy island"). */
export const layoutItems = () => lastItems;
/** Frames as currently shown (island id → box). */
export const currentFrames = () => frames;
/** World box and island of an element. @param {string} id */
export const boxOf = (id) => boxes.get(id);
/** Element boxes inside an island. @param {string} island */
export const boxesIn = (island) => [...boxes].filter(([, b]) => b.island === island);
/** DOM node of a frame. @param {string} island */
export const frameNode = (island) => frameNodes.get(island);
/** DOM node of an element. @param {string} id */
export const elementNode = (id) => nodes.get(id)?.node;
/** View an element is shown in. @param {string} id @returns {View | undefined} */
export const viewOf = (id) => nodes.get(id)?.view;

/** World bounding box of all islands, for "fit". */
export function worldBounds() {
  const all = [...frames.values()];
  if (!all.length) return null;
  return {
    x1: Math.min(...all.map((b) => b.x)),
    y1: Math.min(...all.map((b) => b.y)),
    x2: Math.max(...all.map((b) => b.x + b.w)),
    y2: Math.max(...all.map((b) => b.y + b.h)),
  };
}

/** PRs of an island that no session on the board shows (ADR-0038): the most urgent as a pill, the rest stacked behind. @param {string} island */
function prPill(island) {
  const prs = store.entities.filter((e) => e.kind === "pr" && store.islandOf(e) === island);
  // shown at a session = in that session's stack, not merely linked (a merged PR of a session with an open one is not)
  const o = orphanPrs(prs, (pr) =>
    store.related(pr, "session").some((s) => !store.isArchived(s.ref) && sessionPrs(store.related(s, "pr")).includes(pr)),
  );
  const f = o[0];
  if (!f) return "";
  return prStack({ prs: o.map((p) => p.pr), text: f.label, cls: `frame-pr ${f.mine ? "mine" : "foreign"} ${f.level}`, hint: f.hint });
}
