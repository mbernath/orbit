// @ts-check
// Detail panel size (docs/design/interaction.md "Detail panel"): drag the left edge, double-click restores the default,
// ⤢ / ⌘⇧F full width (the board is hidden). The reply field grows with its text, a handle drags it taller.
// Width, full mode and field height are remembered in this browser.
import { prefs } from "./util.js";

const MIN = 360;
const body = document.body;

/** @param {number} w */
const clampWidth = (w) => Math.round(Math.max(MIN, Math.min(window.innerWidth * 0.9, w)));
/** @param {number | null} w null: the default from the stylesheet */
function setWidth(w) {
  if (w == null) body.style.removeProperty("--panel-w");
  else body.style.setProperty("--panel-w", `${clampWidth(w)}px`);
}

/** @param {() => void} onLayout the board's width changed */
export function installPanelSize(onLayout) {
  const stored = Number(prefs.get("panel.width"));
  if (stored) setWidth(stored);
  if (prefs.get("panel.full") === "1") body.classList.add("panel-full");

  const edge = document.createElement("div");
  edge.className = "panel-edge";
  edge.title = "Drag to resize · double-click: default";
  body.append(edge);
  edge.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    edge.setPointerCapture(ev.pointerId);
    const move = (/** @type {PointerEvent} */ e) => (setWidth(window.innerWidth - e.clientX), onLayout());
    const up = () => {
      edge.removeEventListener("pointermove", move);
      const w = parseInt(body.style.getPropertyValue("--panel-w"));
      if (w) prefs.set("panel.width", String(w));
    };
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up, { once: true });
  });
  edge.addEventListener("dblclick", () => (setWidth(null), prefs.set("panel.width", ""), onLayout()));

  const toggleFull = () => {
    const full = body.classList.toggle("panel-full");
    prefs.set("panel.full", full ? "1" : "");
    onLayout();
  };
  // ⌘⇧F works while typing: the reply field usually has focus
  document.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() !== "f" || !(ev.metaKey || ev.ctrlKey) || !ev.shiftKey || !body.classList.contains("has-panel")) return;
    ev.preventDefault();
    toggleFull();
  });
  return { toggleFull };
}

/**
 * The reply field grows with its text up to 40 % of the panel, or to the height dragged at the handle.
 * @param {HTMLTextAreaElement} ta @param {HTMLElement} grip
 */
export function growField(ta, grip) {
  const panelH = () => ta.closest(".panel")?.clientHeight ?? window.innerHeight;
  let dragged = Number(prefs.get("panel.replyHeight")) || 0;
  const fit = () => {
    ta.style.height = ""; // its natural two rows
    const base = ta.offsetHeight;
    const text = ta.scrollHeight > ta.clientHeight ? Math.min(ta.scrollHeight + base - ta.clientHeight, panelH() * 0.4) : 0;
    const want = Math.min(Math.max(dragged, text), panelH() * 0.7);
    if (want > base) ta.style.height = `${want}px`;
  };
  ta.addEventListener("input", fit);
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const y0 = ev.clientY, h0 = ta.getBoundingClientRect().height;
    const move = (/** @type {PointerEvent} */ e) => ((dragged = Math.max(0, h0 + y0 - e.clientY)), fit());
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", () => (grip.removeEventListener("pointermove", move), prefs.set("panel.replyHeight", String(Math.round(dragged)))), { once: true });
  });
  grip.addEventListener("dblclick", () => ((dragged = 0), prefs.set("panel.replyHeight", ""), fit()));
  requestAnimationFrame(fit);
  return fit;
}
