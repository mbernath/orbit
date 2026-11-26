// @ts-check
// Hover on the board: lifts an element one depth (a short delay keeps things calm while the pointer crosses the
// board). The active island: there is always exactly one, it follows the last move — the pointer, or the element
// keyboard and clicks go to — and it shows its "+" and is where N starts a session.
import { attention } from "./board-layout.js";
import { boxOf } from "./render.js";
import { closest } from "./util.js";

/** make an island the active one (null keeps the current one) @param {string | null | undefined} id */
export function activateIsland(id) {
  if (!id || id === attention.island) return;
  attention.island = id;
  markIsland();
}

/** show the active island on its frame; also runs after a render, which may have created frames */
export function markIsland() {
  document.querySelectorAll(".frame").forEach((f) => f.classList.toggle("hot", /** @type {HTMLElement} */ (f).dataset.frame === attention.island));
}

/** @param {HTMLElement} world @param {() => void} relayout */
export function installHover(world, relayout) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  world.addEventListener("pointerover", (ev) => {
    const id = closest(ev.target, ".glyphview")?.dataset.element ?? null;
    activateIsland(id ? boxOf(id)?.island : closest(ev.target, "[data-frame]")?.dataset.frame);
    clearTimeout(timer);
    if (id === attention.hover) return;
    timer = setTimeout(() => ((attention.hover = id), relayout()), id ? 90 : 250);
  });
  world.addEventListener("pointerleave", () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((attention.hover = null), relayout()), 250);
  });
}
