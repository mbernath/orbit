// @ts-check
// The one table of keys the board shows (ADR-0043): the shortcut overview, tooltips and hints read it, so a key is
// named only where it works. keys.js, panel-size.js and panel-owned.js do the handling. Pure, unit-tested.

/**
 * Where a key acts.
 * board: the board has the focus and nothing is typed (single letters); anywhere: also in the panel and while
 * typing (⌘⇧ combinations, Esc); field: inside a reply field; pointer: a mouse move, written as words.
 * @typedef {"board" | "anywhere" | "field" | "pointer"} KeyContext
 * @typedef {{ id: string, keys: string, does: string, where: KeyContext }} KeyEntry
 */

/** @type {KeyEntry[]} in the overview's order, grouped by `where` */
export const KEYS = [
  { id: "pan", keys: "← ↑ → ↓", does: "Pan the board", where: "board" },
  { id: "zoom", keys: "+ / −", does: "Zoom in / out", where: "board" },
  { id: "next", keys: "W / Q", does: "Next / previous that needs you", where: "board" },
  { id: "open", keys: "Enter", does: "Open details", where: "board" },
  { id: "reply", keys: "Space", does: "Reply", where: "board" },
  { id: "answer", keys: "A / D", does: "Allow / Deny", where: "board" },
  { id: "new", keys: "N", does: "New session", where: "board" },
  { id: "rename", keys: "F2", does: "Rename", where: "board" },
  { id: "remove", keys: "Delete", does: "Remove from board", where: "board" },
  { id: "undo", keys: "⌘Z", does: "Undo", where: "board" },
  { id: "overview", keys: "?", does: "This overview", where: "board" },
  { id: "snooze", keys: "⌘⇧S", does: "Snooze / Seen", where: "anywhere" },
  { id: "full", keys: "⌘⇧F", does: "Full width", where: "anywhere" },
  { id: "remove-open", keys: "⌘⇧⌫", does: "Remove the open one from board", where: "anywhere" },
  { id: "close", keys: "Esc", does: "Close", where: "anywhere" },
  { id: "send", keys: "Enter", does: "Send", where: "field" },
  { id: "newline", keys: "⇧Enter", does: "New line", where: "field" },
  { id: "allow", keys: "⌘Enter", does: "Allow the pending request", where: "field" },
  { id: "send-next", keys: "⌘⇧Enter", does: "Send and open the next that needs you", where: "field" },
  { id: "paste", keys: "⌘V", does: "Paste a file as attachment", where: "field" },
  { id: "island", keys: "Click island name", does: "Island: defaults, clean up", where: "pointer" },
  { id: "new-island", keys: "Double-click free space", does: "New island", where: "pointer" },
];

/** Headings of the overview's groups, in order. @type {[KeyContext, string][]} */
export const GROUPS = [
  ["board", "Board"],
  ["anywhere", "Everywhere, also while typing"],
  ["field", "In a reply field"],
  ["pointer", "Pointer"],
];

/** @param {string} id */
export const keyOf = (id) => KEYS.find((k) => k.id === id);

/**
 * A native tooltip: the label, plus its key in parentheses only where that key works (copy.md "Keys").
 * On the board every board and anywhere key works; in the panel only anywhere keys; in a reply field also its own.
 * @param {string} label @param {string} id @param {"board" | "panel" | "field"} place
 */
export function tip(label, id, place) {
  const k = keyOf(id);
  if (!k) throw new Error(`unknown key "${id}"`);
  const works = k.where === "anywhere" || k.where === place;
  return works ? `${label} (${k.keys})` : label;
}
