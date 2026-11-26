// @ts-check
// The one-time tidy after the list layout arrived (ADR-0012 amendment, docs/design/canvas.md "Auto-layout"): once per
// browser, like the slot memory (`orbit.slots`, debt #48), islands without a hand-moved element get "Tidy island";
// the others are remembered in `orbit.tidy-hint` for the hint "Tidy island: click the name" (hints.js).
// Only slot memory changes — nothing is written to the server.
import { tidyOnce } from "./island-layout.js";
import { rememberSlots, slotMemory } from "./slots.js";
import { prefs } from "./util.js";

/** @type {string[]} */
let hinted = [];
try {
  hinted = JSON.parse(prefs.get("tidy-hint") ?? "[]");
} catch {}

/** Islands that keep hand-moved dots and get the hint. */
export const tidyHintIslands = () => hinted;

/**
 * Run once, on the first layout with elements. @param {string[]} islands @param {Map<string, import("./frames.js").Box>} stored
 * @param {import("./frames.js").LayoutItem[]} items
 */
export function migrateLayout(islands, stored, items) {
  if (prefs.get("tidy-once") || !items.length) return;
  const out = tidyOnce(islands, stored, items, slotMemory());
  rememberSlots(out.slots, () => true);
  hinted = out.hinted;
  prefs.set("tidy-hint", JSON.stringify(hinted));
  prefs.set("tidy-once", "1");
}
