// @ts-check
// Slot memory of the auto-layout (ADR-0012, docs/design/canvas.md "Auto-layout"): which list slot each auto-placed
// element holds, so dots never move when others come, go or change state. Per browser (prefs `orbit.slots`);
// without it the list closes up in creation order on the next load. Element geometry stays untouched: an auto dot
// is not a placed one, so "Tidy island" can still tell them apart.
import { prefs } from "./util.js";

/** @typedef {import("./frames.js").Slots} Slots */

/** @type {Slots} */
let memory = read();
let saved = JSON.stringify([...memory]);

/** @returns {Slots} */
function read() {
  try {
    const raw = JSON.parse(prefs.get("slots") ?? "[]");
    return new Map(Array.isArray(raw) ? raw : []);
  } catch {
    return new Map();
  }
}

/** The slots as last laid out. */
export const slotMemory = () => memory;

/** Remember the slots of a layout run; entries of entities that no longer exist are dropped. @param {Slots} slots @param {(ref: string) => boolean} exists */
export function rememberSlots(slots, exists) {
  memory = new Map([...slots].filter(([ref]) => exists(ref)));
  const s = JSON.stringify([...memory]);
  if (s !== saved) prefs.set("slots", (saved = s));
}
