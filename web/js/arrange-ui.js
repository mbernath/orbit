// @ts-check
// Arranging the selection (ADR-0034): the bar at the top of the board, its keys, group moves, and one undo step each.
// Geometry comes from the pure arrange.js; saving goes through the caller's `save` (one canvas.frame call).
import { align, distribute, GRID, shiftGroup } from "./arrange.js";
import { holdOf } from "./frames.js";
import { selection } from "./selection.js";
import { offerUndo } from "./undo.js";

/** @typedef {import("./frames.js").Box} Box */
/** @typedef {import("./arrange.js").Move} Move */
/** @typedef {import("./arrange.js").AlignMode} AlignMode */

/**
 * @param {{
 *   viewport: HTMLElement,
 *   boxOf: (ref: string) => (Box & { island: string }) | undefined,
 *   anchorOf: (ref: string) => { x: number, y: number } | undefined,
 *   frames: () => Map<string, Box>,
 *   save: (frames: { ws: string, x: number, y: number, w: number, h: number }[], moves: Move[]) => Promise<unknown>,
 * }} ctx
 */
export function installArrange(ctx) {
  const items = (/** @type {string[]} */ refs) =>
    refs.flatMap((ref) => {
      const b = ctx.boxOf(ref);
      return b ? [{ ref, ...b, hold: holdOf(ctx.anchorOf(ref), b.w, b.h) }] : [];
    });

  /** Save moves (and grown frames) as one step, with "Undo". @param {Move[]} moves @param {Map<string, Box>} grown @param {string} text */
  async function apply(moves, grown, text) {
    const changed = moves.filter((m) => {
      const b = ctx.boxOf(m.ref);
      return b && (b.x !== m.x || b.y !== m.y);
    });
    if (!changed.length && !grown.size) return;
    const islands = new Set([...changed.map((m) => ctx.boxOf(m.ref)?.island ?? ""), ...grown.keys()].filter(Boolean));
    const frames = ctx.frames();
    const before = [...islands].flatMap((ws) => (frames.has(ws) ? [{ ws, .../** @type {Box} */ (frames.get(ws)) }] : []));
    const back = changed.map((m) => {
      const b = /** @type {Box} */ (ctx.boxOf(m.ref));
      return { ref: m.ref, x: b.x, y: b.y };
    });
    const after = before.map((f) => ({ ...f, ...(grown.get(f.ws) ?? {}) }));
    await ctx.save(after, changed);
    offerUndo({ text, undo: () => ctx.save(before, back) });
  }

  const moveBy = (/** @type {string[]} */ refs, /** @type {number} */ dx, /** @type {number} */ dy) => {
    const r = shiftGroup(ctx.frames(), items(refs), dx, dy);
    return apply(r.moves, r.frames, `${refs.length} ${refs.length === 1 ? "element" : "elements"} moved`);
  };
  const alignTo = (/** @type {AlignMode} */ mode) => apply(align(items(selection.list()), mode), new Map(), "Aligned");
  const spread = (/** @type {"h" | "v"} */ axis) => apply(distribute(items(selection.list()), axis), new Map(), "Distributed");

  // ---------- bar ----------
  const bar = document.createElement("div");
  bar.className = "arrange no-drag";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Arrange selection");
  /** @type {[string, string, string, () => unknown, number][]} label, title, key hint, run, minimum selection */
  const buttons = [
    ["⇤", "Align left", "⌥←", () => alignTo("left"), 2],
    ["↔", "Center horizontally", "⌥H", () => alignTo("hcenter"), 2],
    ["⇥", "Align right", "⌥→", () => alignTo("right"), 2],
    ["⤒", "Align top", "⌥↑", () => alignTo("top"), 2],
    ["↕", "Center vertically", "⌥V", () => alignTo("vcenter"), 2],
    ["⤓", "Align bottom", "⌥↓", () => alignTo("bottom"), 2],
    ["⋯", "Distribute horizontally", "⌥⇧H", () => spread("h"), 3],
    ["⋮", "Distribute vertically", "⌥⇧V", () => spread("v"), 3],
  ];
  const count = document.createElement("span");
  count.className = "arrange-count";
  bar.append(count);
  const nodes = buttons.map(([label, title, key, run, min]) => {
    const b = document.createElement("button");
    b.className = "btn quiet";
    b.textContent = label;
    b.title = `${title} (${key})`;
    b.setAttribute("aria-label", title);
    b.dataset.arrange = title;
    b.addEventListener("click", () => run());
    if (label === "⤒" || label === "⋯") bar.append(Object.assign(document.createElement("span"), { className: "arrange-sep" }));
    bar.append(b);
    return { b, min };
  });
  ctx.viewport.appendChild(bar);
  selection.onChange(() => {
    const n = selection.size();
    bar.hidden = n < 2;
    count.textContent = `${n} selected`;
    for (const { b, min } of nodes) b.disabled = n < min;
  });

  // ---------- keys (before keys.js: arrows nudge instead of panning while something is selected) ----------
  const own = (/** @type {EventTarget | null} */ t) =>
    !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && (t.isContentEditable || t.closest("#panel, .menu, dialog, [role=dialog]"))));
  /** @type {Record<string, [number, number, AlignMode]>} */
  const arrows = { ArrowLeft: [-1, 0, "left"], ArrowRight: [1, 0, "right"], ArrowUp: [0, -1, "top"], ArrowDown: [0, 1, "bottom"] };
  document.addEventListener(
    "keydown",
    (ev) => {
      if (!selection.size() || ev.metaKey || ev.ctrlKey || !own(ev.target)) return;
      const arrow = arrows[ev.key];
      const done = () => (ev.preventDefault(), ev.stopImmediatePropagation());
      if (arrow && ev.altKey) return selection.size() > 1 && alignTo(arrow[2]), done();
      if (arrow) {
        const step = GRID * (ev.shiftKey ? 10 : 1);
        return moveBy(selection.list(), arrow[0] * step, arrow[1] * step), done();
      }
      if (!ev.altKey || selection.size() < 2) return;
      if (ev.code === "KeyH") return (ev.shiftKey ? spread("h") : alignTo("hcenter")), done();
      if (ev.code === "KeyV") return (ev.shiftKey ? spread("v") : alignTo("vcenter")), done();
    },
    { capture: true },
  );

  return { moveBy };
}
