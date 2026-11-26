// @ts-check
// Sizes of an element's name and bubble at a depth, measured on an invisible copy (outside the board, never seen) and
// cached until the element's content or view classes change. Measuring never touches the element the user sees: changing
// its depth or classes just to read a size forced the browser to compute in-between states, and CSS transitions then
// faded every element in again — the flicker after each change.
// Measure only while the board is shown: the measurer lives in the viewport, which is display:none in the panel's
// full mode, and everything measures 0 there.

/** @typedef {{ lab: { w: number, h: number }, bub: { w: number, h: number } }} Size */

/** @type {Map<string, Size>} */
const cache = new Map();
/** @type {HTMLElement | null} */
let box = null;

/** @param {HTMLElement} viewport @param {HTMLElement} node @param {number} depth @returns {Size} */
export function measureCopy(viewport, node, depth) {
  const key = `${node.dataset.element}|${node.dataset.html}|${node.dataset.own}|${depth}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!box || !box.isConnected) {
    box = document.createElement("div");
    box.className = "measurer";
    box.setAttribute("aria-hidden", "true");
    viewport.append(box);
  }
  const copy = /** @type {HTMLElement} */ (node.cloneNode(true));
  copy.removeAttribute("data-element"); // never found by queries for the real one
  copy.classList.add("measuring");
  copy.dataset.depth = String(depth);
  copy.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
  box.replaceChildren(copy);
  const lab = /** @type {HTMLElement | null} */ (copy.querySelector(".lab"));
  const bub = /** @type {HTMLElement | null} */ (copy.querySelector(".bub"));
  const size = {
    lab: { w: lab?.scrollWidth ?? 0, h: lab?.offsetHeight ?? 0 },
    bub: { w: bub?.offsetWidth ?? 0, h: bub?.offsetHeight ?? 0 },
  };
  box.replaceChildren();
  // a name with text but no width was measured while the board was hidden: use it once, never keep it
  if (lab?.textContent?.trim() && !size.lab.w) return size;
  if (cache.size > 2000) cache.clear();
  cache.set(key, size);
  return size;
}
