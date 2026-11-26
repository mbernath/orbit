// @ts-check
// Shortcut overview ("?"): the keys of key-table.js, grouped by where they work (ADR-0043). Keys as <kbd> through
// kbd() (copy.md "Keys"); pointer moves are words.
import { GROUPS, KEYS } from "./key-table.js";
import { esc, kbd } from "./util.js";

/** @type {HTMLElement | null} */
let box = null;

/** Show, hide or flip the overview. @param {boolean} [on] @returns {boolean} whether something changed */
export function toggleShortcuts(on = !box) {
  if (!on) {
    if (!box) return false;
    box.remove();
    box = null;
    return true;
  }
  if (box) return false;
  box = document.createElement("div");
  box.className = "shortcuts";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Keyboard shortcuts");
  const group = (/** @type {string} */ where, /** @type {string} */ title) =>
    `<h3>${esc(title)}</h3><dl>${KEYS.filter((k) => k.where === where)
      .map((k) => `<dt${where === "pointer" ? ' class="pointer"' : ""}>${where === "pointer" ? esc(k.keys) : kbd(k.keys)}</dt><dd>${esc(k.does)}</dd>`)
      .join("")}</dl>`;
  box.innerHTML = `<h2>Keyboard shortcuts</h2>${GROUPS.map(([w, t]) => group(w, t)).join("")}`;
  box.addEventListener("click", () => toggleShortcuts(false));
  document.body.append(box);
  return true;
}
