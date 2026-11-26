// @ts-check
// View registry (ADR-0008): how an entity kind is rendered, chosen per element.
//
// Two ways to render:
//   - `render(e, el)` returns HTML. Simple, stateless; the renderer replaces it when it changes.
//   - `mount(node, e, el)` / `update(node, e, el)` / `unmount(node)` for views that keep their own DOM state
//     (an editor, a live view). The renderer never touches their innerHTML.
//
// Interaction in HTML-rendered views is declared with data attributes and handled centrally:
//   data-action="<action id>" data-input='<json>'  → runs the action
//   data-dialog="<name>" data-ref="<entity ref>"   → opens a dialog
//   data-edit="<action id>" data-input='<json>' data-field="<input key>" data-value="…" data-placeholder="…"
//                                                   → inline edit, saved through the action

/** @typedef {import("../../../src/core/types").ResolvedEntity} Entity */
/** @typedef {import("../../../src/core/types").Element} CanvasElement */

/**
 * @typedef {object} View
 * @property {string} id                                   e.g. "card"
 * @property {string} kind                                 entity kind, e.g. "session"
 * @property {(e: Entity) => { w: number, h: number }} size default size in world units
 * @property {number} [rank]                               auto-layout order within a lane; lower comes first (default 0)
 * @property {(e: Entity) => string} [className]           extra classes for the element container
 * @property {(e: Entity, el: CanvasElement | undefined) => string} [render]
 * @property {(node: HTMLElement, e: Entity, el: CanvasElement | undefined) => void} [mount]
 * @property {(node: HTMLElement, e: Entity, el: CanvasElement | undefined) => void} [update]
 * @property {(node: HTMLElement) => void} [unmount]
 * Glyph views (a dot or page with name and bubble, placed by placement.js) also declare:
 * @property {{ x: number, y: number }} [anchor]           where the glyph sits inside the element box (world units)
 * @property {(e: Entity) => { w: number, h: number, x: number, y: number }} [slot] what the auto-layout spaces (glyph
 *   and name; x, y = where the glyph sits in it) — the rest of the box is bubble room and never affects geometry
 * @property {(e: Entity, depth: number) => boolean} [bubbleAt] whether the element has a bubble at this depth
 * @property {(e: Entity) => boolean} [asks]               waits for the user's answer: its bubble may overlay when there is no room
 * @property {(e: Entity) => number} [prio]                 placement priority: 3 needs the user, 2 working, 1 document, 0 resting
 */

/** Slot of a glyph with its name in the auto-layout list (docs/design/canvas.md "Auto-layout"). */
export const glyphSlot = () => ({ w: 200, h: 40, x: 12, y: 20 });

/** @type {Map<string, View[]>} */
const byKind = new Map();

/** @param {View} view */
export function registerView(view) {
  if (!view.render && !view.mount) throw new Error(`View ${view.kind}/${view.id} needs render or mount`);
  byKind.set(view.kind, [...(byKind.get(view.kind) ?? []), view]);
}

/** The element's chosen view, else the first registered one for the kind. @param {string} kind @param {string | null} [id] */
export function viewFor(kind, id) {
  const views = byKind.get(kind) ?? [];
  return views.find((v) => v.id === id) ?? views[0];
}

/** @param {unknown} input */
export const inputAttr = (input) => `data-input='${JSON.stringify(input).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'`;
