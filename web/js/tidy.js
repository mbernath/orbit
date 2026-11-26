// @ts-check
// "Tidy island" (ADR-0012, docs/design/canvas.md "Auto-layout"): the only way auto-placed dots close up. Repacks the
// island's unmoved elements in creation order and fits a stored frame to them; moved elements stay. Undoable.
import { runAction } from "./api.js";
import { tidyIsland } from "./island-layout.js";
import { layoutItems } from "./render.js";
import { rememberSlots, slotMemory } from "./slots.js";
import { store } from "./store.js";
import { offerUndo } from "./undo.js";

/** @param {import("./frames.js").Box} f @param {string} ws */
const saveFrame = (f, ws) => runAction("canvas.frame", { ws, x: f.x, y: f.y, w: f.w, h: f.h });

/** @param {string} island @param {() => Promise<void>} refresh */
export async function tidy(island, refresh) {
  const before = new Map(slotMemory());
  const stored = store.storedFrames();
  const old = stored.get(island);
  const { frame, slots } = tidyIsland(store.islands(), stored, layoutItems(), before, island);
  rememberSlots(slots, () => true);
  const resized = !!(frame && old && (frame.w !== old.w || frame.h !== old.h));
  if (resized) await saveFrame(/** @type {import("./frames.js").Box} */ (frame), island);
  offerUndo({
    text: "Island tidied",
    undo: async () => {
      rememberSlots(before, () => true);
      if (resized && old) await saveFrame(old, island);
      await refresh();
    },
  });
  await refresh();
}
