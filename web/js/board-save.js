// @ts-check
// Geometry changes the user makes (ADR-0012): shown at once from optimistic local copies, then saved with one request.
// Islands keep the place they are shown at once the user changes any island, so nothing else moves.
// Split from main.js (debt #44).
import { runAction } from "./api.js";
import { currentFrames } from "./render.js";
import { store } from "./store.js";

/** @typedef {import("./frames.js").Box} Box */
/** @typedef {{ ref: string, x: number, y: number }} Move */

/** @param {{ render: () => void, refresh: () => void }} o */
export function createSaver({ render, refresh }) {
  /** islands not stored yet, at the place they are shown */
  const frameChanges = () => {
    const stored = store.storedFrames();
    return [...currentFrames()].filter(([id]) => !stored.has(id)).map(([ws, f]) => ({ ws, ...f }));
  };

  /** Several frames at once (a selection spanning islands, ADR-0034), atomically on the server. @param {({ ws: string } & Box)[]} changed @param {Move[]} [moves] */
  async function saveFrames(changed, moves) {
    const mine = new Set(changed.map((c) => c.ws));
    const frames = [...frameChanges().filter((o) => !mine.has(o.ws)), ...changed];
    for (const o of frames) storeFrame(o.ws, o);
    for (const m of moves ?? []) storePlace(m.ref, m.x, m.y);
    render();
    await runAction("canvas.frame", { frames, ...(moves?.length ? { moves } : {}) });
    refresh();
  }

  return {
    saveFrames,
    /** this frame, every island not stored yet, and the moved elements @param {string} ws @param {Box} f @param {Move[]} [moves] */
    saveFrame: (ws, f, moves = []) => saveFrames([{ ws, ...f }], moves),
    storePlace,
  };
}

/** optimistic local copies, so nothing jumps until the next update @param {string} ws @param {Box} f */
function storeFrame(ws, f) {
  const id = `frame:${ws}`;
  const el = store.elements.get(id);
  if (el) Object.assign(el, f);
  else store.elements.set(id, { id, ref: `frame:core/${ws}`, view: null, ...f, z: 0, parent: null, state: {}, archived: false, updatedAt: Date.now() });
}

/** @param {string} ref @param {number} x @param {number} y */
function storePlace(ref, x, y) {
  const el = store.elements.get(ref);
  if (el) Object.assign(el, { x, y });
  else store.elements.set(ref, { id: ref, ref, view: null, x, y, w: null, h: null, z: 0, parent: null, state: {}, archived: false, updatedAt: Date.now() });
}
