// @ts-check
// Board entry: wires store, canvas and renderer, the "+" menu, the panel and the generic interaction handlers.
import { loadState, runAction, setErrorHandler, subscribe } from "./api.js";
import { attention, FRESH_MS, layoutBoard } from "./board-layout.js";
import { installChrome } from "./board-chrome.js";
import { createSaver } from "./board-save.js";
import { LEVEL_K } from "./camera.js";
import { createCanvas } from "./canvas.js";
import { openMergeDialog } from "./dialogs/merge.js";
import { dropInFrame, holdOf } from "./frames.js";
import { startInlineEdit } from "./inline-edit.js";
import { activateIsland, installHover, markIsland } from "./hover.js";
import { createIslandMenu } from "./island-menu.js";
import { installKeys, nextNeeding } from "./keys.js";
import { islandKey } from "./panel-island.js";
import { createPanel } from "./panel.js";
import { installPrStack } from "./pr-stack.js";
import { installPanelSize } from "./panel-size.js";
import { takeOff } from "./remove.js";
import { say } from "./undo.js";
import { boxesIn, boxOf, currentFrames, elementNode, frameNode, renderCanvas, viewOf, visibleElements, worldBounds } from "./render.js";
import { inRect } from "./arrange.js";
import { installArrange } from "./arrange-ui.js";
import { selection } from "./selection.js";
import { store } from "./store.js";
import { $, closest } from "./util.js";
import "./copy.js";
import "./file-links.js";
import "./color-pop.js";
import { syncHookNotice } from "./hook-notice.js";
import { installFirstRun, renderFirstRun } from "./first-run.js";
import { installHints, update as updateHints } from "./hints.js";
import "./views/file-page.js";
import "./views/list-node.js";
import "./views/agent-dot.js";
import "./views/session-dot.js";
import { collectAsk } from "./views/ask.js";

/** @typedef {import("./frames.js").Box} Box */

const viewport = $("viewport");
const world = $("world");
/** @type {string | null} */
let editingId = null;
let fitPending = false;
let layoutQueued = 0; // declared before the canvas: its first view change already asks for a layout

// ---------- Errors ----------
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
setErrorHandler((text) => {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 8000);
});

// ---------- Geometry changes made by the user (board-save.js) ----------
const { saveFrame, saveFrames, storePlace } = createSaver({ render: () => render(), refresh: () => scheduleRefresh() });

// ---------- Canvas ----------
const canvas = createCanvas({
  viewport,
  world,
  frames: currentFrames,
  content: (island) => boxesIn(island).map(([id, box]) => ({ id, box, node: elementNode(id) })),
  frameNode,
  async onPlace(ref, x, y) {
    const b = boxOf(ref);
    if (!b) return;
    const r = dropInFrame(currentFrames(), b.island, { x, y, w: b.w, h: b.h }, holdOf(viewOf(ref)?.anchor, b.w, b.h));
    storePlace(ref, r.el.x, r.el.y);
    if (r.frame) return saveFrame(b.island, r.frame, [{ ref, ...r.el }]);
    render();
    await runAction("canvas.place", { ref, ...r.el });
  },
  selected: () => selection.list(),
  onToggleSelect: (id) => selection.toggle(id),
  onLasso: (r) => selection.set(inRect(visibleElements().flatMap((e) => {
    const b = boxOf(e.ref);
    return b ? [{ ref: e.ref, ...b, anchor: viewOf(e.ref)?.anchor ?? { x: 0, y: 0 } }] : [];
  }), r), true),
  onGroupMove: (ids, dx, dy) => arrange.moveBy(ids, dx, dy),
  onFrameMove: (island, f, moves) => saveFrame(island, f, moves.filter((m) => store.placed(m.ref))),
  onFrameResize: (island, f) => saveFrame(island, f),
  onViewChange: () => relayout(),
  // a click means "work on this": the cursor goes straight into the reply field
  onElementClick: (id) => (attention.focus = id, panel.open(id), relayout(), panel.reply()),
  onFrameClick: (id) => panel.open(islandKey(id)), // ADR-0042
  onBackgroundClick: () => (selection.clear(), panel.close(), attention.focus && ((attention.focus = null), relayout())),
});
fitPending = !canvas.hadView;
// zoom dots, minimap, and which island lies where on screen (board-chrome.js)
const { toLevel, currentLevel, islandAt, mostVisibleIsland } = installChrome({ viewport, canvas });
const arrange = installArrange({ viewport, boxOf, anchorOf: (ref) => viewOf(ref)?.anchor, frames: currentFrames, save: saveFrames });

// ---------- Render ----------
/** @type {Map<string, string>} ref -> state seen last render. Only a change of state is "fresh": every tool step of a
 * working session would otherwise lift it for 10 s and make its bubble pop in and out. */
const seenState = new Map();
function render() {
  const { visible } = renderCanvas(world, { isDragging: canvas.isDragging, editingId });
  for (const e of store.entities) {
    if (e.kind !== "session") continue;
    const now = `${e.status}|${e.attention?.level ?? ""}|${store.related(e, "control")[0]?.status ?? ""}`;
    const before = seenState.get(e.ref);
    if (before !== undefined && now !== before) {
      attention.fresh.set(e.ref, Date.now());
      setTimeout(relayout, FRESH_MS + 50);
    }
    seenState.set(e.ref, now);
  }
  selection.sync((ref) => !!boxOf(ref));
  renderEmpty(visible);
  panel.update();
  if (fitPending && visible) {
    fitPending = false;
    canvas.fitStart(worldBounds());
  }
  // at once, not in the next frame: re-rendered elements must never be painted without their corner and side
  layoutNow();
}

// ---------- Placement of names, bubbles, edge hints and the minimap (runs on change, not on a timer) ----------
/** @type {string | null} */
let focusedBefore = null;
const focusedIsland = () => {
  const e = attention.focus ? store.byRef.get(attention.focus) : undefined;
  return e ? store.islandOf(e) : null;
};
new ResizeObserver(() => relayout()).observe(viewport); // shown again or resized
function relayout() {
  if (layoutQueued) return;
  layoutQueued = requestAnimationFrame(layoutNow);
}
function layoutNow() {
  if (layoutQueued) cancelAnimationFrame(layoutQueued);
  layoutQueued = 0;
  // hidden board (panel full mode): nothing can be measured; the ResizeObserver below lays out again once it is shown
  if (!viewport.offsetWidth) return;
  const { level } = layoutBoard({ viewport, view: canvas.view(), onHint: goTo, onIsland: showIsland, onElement: (ref) => (showIsland(boxOf(ref)?.island ?? ""), goTo(ref)) });
  // the active island follows the element keyboard or a click went to; without any, the one most on screen
  if (attention.focus !== focusedBefore) (focusedBefore = attention.focus), activateIsland(focusedIsland());
  if (!attention.island || !currentFrames().has(attention.island)) attention.island = null, activateIsland(mostVisibleIsland());
  markIsland();
  document.querySelectorAll(".zd").forEach((b) => b.classList.toggle("on", /** @type {HTMLElement} */ (b).dataset.level === String(level)));
  updateHints();
}

/** pan just enough to show an element's glyph with room around (never zooms) @param {string} ref @param {number} margin */
function revealGlyph(ref, margin) {
  const b = boxOf(ref);
  const a = viewOf(ref)?.anchor ?? { x: 0, y: 0 };
  if (b) canvas.reveal({ x: b.x + a.x - 10, y: b.y + a.y - 10, w: 20, h: 20 }, margin);
}
/** atlas click (ADR-0037): middle zoom, the island in view — top left first when it is larger than the screen @param {string} id */
function showIsland(id) {
  const f = currentFrames().get(id);
  if (!f) return;
  canvas.zoomTo(LEVEL_K.middle);
  canvas.centerOn(f.x + f.w / 2, f.y + f.h / 2);
  canvas.reveal(f, 60);
}
/** navigate to an element: focus it and reveal it @param {string} ref */
function goTo(ref) {
  attention.focus = ref;
  revealGlyph(ref, 130);
  relayout();
}

installHover(world, relayout);
installPrStack();

async function refresh() {
  try {
    store.load(await loadState());
    render();
  } catch {}
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let refreshTimer;
const scheduleRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 30);
};

/** No island yet: the first-run suggestions (ADR-0041); islands with nothing on them: how to bring things back. @param {number} shown */
function renderEmpty(shown) {
  renderFirstRun();
  syncHookNotice();
  const empty = $("empty");
  const hide = shown > 0 || !store.workspaces.length;
  if (empty.hidden !== hide) empty.hidden = hide; // write only on change, like every board update
  empty.textContent ||= "Nothing here right now. Click an island’s name to bring back what you removed from the board.";
}

// ---------- Island menu, detail panel, taking things off the board ----------
/** @param {string} ref */
const revealRef = (ref) => {
  const box = boxOf(ref);
  if (box) canvas.reveal(box, 80);
};
const islandMenu = createIslandMenu({
  refresh,
  reveal: revealRef,
  revealIsland: (id) => {
    const f = currentFrames().get(id);
    if (f) canvas.reveal(f, 60);
  },
});
const panelLayout = () => {
  relayout();
  // the board narrowed: shift only if the open element's glyph is now hidden (interaction.md)
  const ref = panel.current();
  if (ref) requestAnimationFrame(() => revealGlyph(ref, 40));
};
const panelSize = installPanelSize(panelLayout);
const panel = createPanel({
  onChange: scheduleRefresh,
  refresh,
  onLayout: panelLayout,
  onRemove: (ref) => remove(ref),
  // ⌘⇧Enter: the next element that needs the user, in the panel with the cursor in its reply field (interaction.md)
  onNext: (from) => {
    const next = nextNeeding(from);
    if (!next || next === from) return panel.close(), viewport.focus(), say("All done");
    panel.open(next);
    panel.reply();
    goTo(next);
  },
  onClosed: () => viewport.focus(),
  toggleFull: () => panelSize.toggleFull(),
  reveal: revealRef,
});
/** @param {string} ref */
function remove(ref) {
  if (panel.current() === ref) panel.close();
  if (attention.focus === ref) attention.focus = null;
  return takeOff(ref, scheduleRefresh);
}
document.addEventListener("pointerdown", (ev) => {
  if (islandMenu.isOpen() && !closest(ev.target, ".menu, [data-island-menu]")) islandMenu.close();
});

// ---------- Generic interactions declared by views (see views/registry.js) ----------
document.addEventListener("click", async (ev) => {
  const t = ev.target;
  const im = closest(t, "[data-island-menu]");
  if (im) return islandMenu.isOpen() ? islandMenu.close() : islandMenu.open(im.dataset.islandMenu ?? "", im);
  const rm = closest(t, "[data-remove]"); // "Done · Remove from board" (ADR-0023): with undo, like Delete
  if (rm) return remove(rm.dataset.remove ?? "");
  const act = closest(t, "[data-action]");
  if (act) {
    const extra = act.hasAttribute("data-collect") ? collectAsk(act) : {}; // answers typed or picked (ADR-0028)
    await runAction(act.dataset.action ?? "", { ...JSON.parse(act.dataset.input ?? "{}"), ...extra });
    return scheduleRefresh();
  }
  const dialog = closest(t, "[data-dialog]");
  if (dialog?.dataset.dialog === "merge") return openMergeDialog(dialog.dataset.ref ?? "", scheduleRefresh);
});

viewport.addEventListener("dblclick", (ev) => {
  // the island name: its panel with the name ready to rename (ADR-0042)
  // (by position: the canvas captures the pointer, so the event's target is the viewport)
  const under = document.elementFromPoint(ev.clientX, ev.clientY);
  const head = closest(under, "[data-frame-move]");
  if (head && !closest(under, "button, a")) return panel.open(islandKey(head.dataset.frameMove ?? "")), panel.edit();
  // free space outside every island: new island (interaction.md)
  // (frames take pointer events only at their name, so whether the point lies in an island is checked by geometry)
  if (!closest(ev.target, "[data-frame], [data-element], .chrome, .minimap, .edges, .menu")) {
    if (!islandAt(ev.clientX, ev.clientY)) return islandMenu.open("", { x: ev.clientX, y: ev.clientY }, "new-island");
    return;
  }
  const field = closest(ev.target, "[data-edit]");
  const node = closest(field ?? ev.target, "[data-element]");
  if (node && !field && store.byRef.get(node.dataset.element ?? "")?.kind === "file") {
    // a document is edited in the panel (elements.md)
    panel.open(node.dataset.element ?? "");
    return panel.edit();
  }
  if (!field || !node) return;
  editingId = node.dataset.element ?? null;
  startInlineEdit(field, () => {
    editingId = null;
    delete node.dataset.html; // force re-render
    scheduleRefresh();
  });
});

// ---------- Keyboard ----------
// the pointer anywhere inside an island makes it the active one (hover.js only sees names and elements)
viewport.addEventListener("pointermove", (ev) => activateIsland(islandAt(ev.clientX, ev.clientY)));

installKeys({
  mostVisibleIsland,
  revealIsland: (id) => {
    const f = currentFrames().get(id);
    if (f) canvas.reveal(f, 60);
  },
  viewport,
  panel,
  menu: islandMenu,
  relayout,
  panBy: (dx, dy) => canvas.panBy(dx, dy),
  level: (step) => toLevel(Math.max(0, Math.min(2, currentLevel() + step))),
  goTo,
  remove,
  frameNode,
  changed: scheduleRefresh,
});

installFirstRun({ added: () => ((fitPending = true), refresh()), chooseOther: (b) => islandMenu.open("", b, "new-island"), refresh });
installHints();

// ---------- Start: push updates, plus a slow refresh for relative times ----------
subscribe(scheduleRefresh);
setInterval(refresh, 30_000);
refresh();
