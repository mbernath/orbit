// @ts-check
// Selection of several elements (ADR-0034): board state only, never stored. Owns the class `selected` (ADR-0022).

/** @type {Set<string>} */
const refs = new Set();
/** @type {Set<() => void>} */
const listeners = new Set();

const changed = () => {
  for (const n of document.querySelectorAll("[data-element].selected")) if (!refs.has(/** @type {HTMLElement} */ (n).dataset.element ?? "")) n.classList.remove("selected");
  for (const ref of refs) document.querySelector(`[data-element="${CSS.escape(ref)}"]`)?.classList.add("selected");
  for (const fn of listeners) fn();
};

export const selection = {
  /** @returns {string[]} */
  list: () => [...refs],
  size: () => refs.size,
  /** @param {string} ref */
  has: (ref) => refs.has(ref),
  /** @param {string} ref */
  toggle(ref) {
    if (!refs.delete(ref)) refs.add(ref);
    changed();
  },
  /** @param {string[]} list @param {boolean} [add] keep the current selection */
  set(list, add = false) {
    if (!add) refs.clear();
    for (const r of list) refs.add(r);
    changed();
  },
  /** @returns {boolean} whether there was a selection */
  clear() {
    if (!refs.size) return false;
    refs.clear();
    changed();
    return true;
  },
  /** Drop refs no longer on the board and re-apply the class to re-created nodes. @param {(ref: string) => boolean} exists */
  sync(exists) {
    for (const r of [...refs]) if (!exists(r)) refs.delete(r);
    changed();
  },
  /** @param {() => void} fn */
  onChange: (fn) => void listeners.add(fn),
};
