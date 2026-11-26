// @ts-check

/** @param {string} id @returns {HTMLElement} */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

/** @template {HTMLElement} T @param {string} id @param {new () => T} type @returns {T} */
export function $as(id, type) {
  const el = $(id);
  if (!(el instanceof type)) throw new Error(`#${id} has the wrong type`);
  return el;
}

/** @param {unknown} s */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * Keys as the board shows them (copy.md "Keys"): every key its own <kbd> (a combination like ⌘Z is one key),
 * a space separates keys of a group, " / " separates alternatives.
 * @param {string} spec e.g. "N", "W / Q", "Delete / ⌘⇧⌫", "← ↑ → ↓"
 */
export const kbd = (spec) =>
  spec.split(" / ").map((alt) => alt.split(" ").map((k) => `<kbd>${esc(k)}</kbd>`).join(" ")).join(" / ");

/** @param {number} ts */
export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** @param {string | null | undefined} p */
export const folderName = (p) => (p ? p.split("/").filter(Boolean).pop() ?? "" : "");
/** Folder of a file path. @param {string} p */
export const folderOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";

/** Per-browser preferences. Storage can be unavailable; the board works without it. */
export const prefs = {
  /** @param {string} k */
  get(k) {
    try {
      return localStorage.getItem(`orbit.${k}`);
    } catch {
      return null;
    }
  },
  /** @param {string} k @param {string} v */
  set(k, v) {
    try {
      localStorage.setItem(`orbit.${k}`, v);
    } catch {}
  },
};

/** Closest ancestor (or self) matching a selector, for event delegation. @param {EventTarget | null} t @param {string} sel */
export function closest(t, sel) {
  return t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest(sel)) : null;
}

/** The home part of a path as "~", as the user reads it (the board does not know the home dir). @param {string} p */
export const tilde = (p) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~");
