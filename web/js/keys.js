// @ts-check
// Keyboard (docs/design/interaction.md). Anywhere: Esc closes the innermost thing, ⌘Z undoes, ? shows the overview.
// On the board: arrows pan, + / − change the level, W / Q attention navigation, and keys acting on one element.
import { runAction } from "./api.js";
import { attention, needsUser } from "./board-layout.js";
import { readingOrder } from "./frames.js";
import { boxOf, currentFrames } from "./render.js";
import { toggleShortcuts } from "./shortcuts.js";
import { selection } from "./selection.js";
import { store } from "./store.js";
import { undoLast } from "./undo.js";
import { controlOf } from "./views/session-dot.js";

/**
 * @param {{
 *   viewport: HTMLElement,
 *   mostVisibleIsland: () => string | null,
 *   revealIsland: (id: string) => void,
 *   panel: { current: () => string | null, open: (ref: string) => void, edit: () => void, escape: () => boolean, reply: () => void },
 *   menu: { isOpen: () => boolean, close: () => void, open: (island: string, anchor: HTMLElement, view?: "main" | "new-session") => void },
 *   relayout: () => void,
 *   panBy: (dx: number, dy: number) => void,
 *   level: (step: number) => void,
 *   goTo: (ref: string) => void,
 *   remove: (ref: string) => void,
 *   frameNode: (island: string) => HTMLElement | undefined,
 *   changed: () => void,
 * }} ctx
 */
export function installKeys(ctx) {
  const { viewport, panel } = ctx;

  /** ⌘⇧S: Snooze / Seen */
  const later = (/** @type {string} */ ref) => {
    const e = store.byRef.get(ref);
    if (e?.actions.includes("claude.ack")) runAction("claude.ack", { id: /** @type {any} */ (e.data).id }).then(ctx.changed);
  };
  // ⌘⇧S works everywhere, like ⌘⇧F (ADR-0043): on the open element in the panel, also while typing its reply;
  // on the board on the focused or hovered one. ev.code, since ⇧ turns the key into "S" or, on some layouts, else
  document.addEventListener("keydown", (ev) => {
    if (ev.code !== "KeyS" || !(ev.metaKey || ev.ctrlKey) || !ev.shiftKey || ev.altKey) return;
    const ref = panel.current() ?? attention.focus ?? attention.hover;
    if (!ref) return;
    ev.preventDefault(); // never the browser's own ⌘⇧S
    later(ref);
  });
  /**
   * N: new session in the active island (the one showing its "+", hover.js); one without a folder falls back to the
   * island taking the most room on screen. It is brought into view first, so the form opens at its "+".
   */
  const newSession = () => {
    const real = (/** @type {string | null | undefined} */ id) => (id && store.workspaces.some((w) => w.id === id) ? id : null);
    const island = real(attention.island) ?? real(ctx.mostVisibleIsland()) ?? store.workspaces[0]?.id ?? null;
    if (!island) return;
    ctx.revealIsland(island);
    const head = ctx.frameNode(island)?.querySelector(".frame-add");
    if (head) ctx.menu.open(island, /** @type {HTMLElement} */ (head), "new-session");
  };
  /** Space: reply — in the panel for now (the reply bubble is still open, debt #18) */
  const reply = (/** @type {string} */ ref) => (panel.open(ref), panel.reply());
  /** A / D: allow / deny a pending permission request */
  const answer = (/** @type {string} */ ref, /** @type {boolean} */ allow) => {
    const e = store.byRef.get(ref);
    const ctl = e && controlOf(e);
    if (ctl?.status === "permission") runAction("owned.answer", { id: /** @type {any} */ (ctl.data).id, allow }).then(ctx.changed);
  };
  const typing = (/** @type {EventTarget | null} */ t) =>
    t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
  /** the element keys act on: keyboard focus, else the open panel, else the hovered one */
  const target = () => attention.focus ?? panel.current() ?? attention.hover;

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (ctx.menu.isOpen()) return ctx.menu.close();
      if (toggleShortcuts(false)) return;
      if (typing(ev.target)) return; // fields handle their own Esc
      if (panel.escape()) return viewport.focus();
      if (selection.clear()) return;
      if (attention.focus) (attention.focus = null), ctx.relayout();
      return;
    }
    if (typing(ev.target)) return;
    if (ev.key === "z" && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey) {
      ev.preventDefault();
      undoLast();
      return;
    }
    if (ev.key === "?") toggleShortcuts();
  });

  /** @type {Record<string, [number, number]>} */
  const arrows = { ArrowLeft: [90, 0], ArrowRight: [-90, 0], ArrowUp: [0, 90], ArrowDown: [0, -90] };
  /**
   * Board keys act wherever the focus is, except where another area owns the keys: text fields, an open menu,
   * a dialog, the panel. A button on the board keeps Enter and Space (native activation).
   */
  const onBoard = (/** @type {KeyboardEvent} */ ev) => {
    const t = ev.target;
    if (typing(t) || ctx.menu.isOpen()) return false;
    if (t === viewport || t === document.body || t === document.documentElement) return true;
    if (!(t instanceof Element) || !viewport.contains(t) || t.closest(".menu, dialog, [role=dialog], #panel")) return false;
    return ev.key !== "Enter" && ev.key !== " ";
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || !onBoard(ev)) return;
    // a board key takes the focus back from a clicked button ("+", zoom dots), so its ring does not light up
    // ⌘ / Ctrl shortcuts belong to the browser (⌘C): moving the focus first drops the text selection (Safari)
    const shortcut = ev.metaKey || ev.ctrlKey;
    if (ev.target !== viewport && !shortcut && !/^(Tab|Shift|Meta|Alt|Control|CapsLock)$/.test(ev.key)) viewport.focus({ preventScroll: true });
    const ref = target();
    if (ref && ev.key === "Enter") {
      attention.focus = ref;
      panel.open(ref);
      // full mode hides the board, so its focus would swallow the keys: go straight to the reply field
      // (preventDefault: else this Enter lands in the field as a newline)
      if (document.body.classList.contains("panel-full")) ev.preventDefault(), panel.reply();
      return;
    }
    if (ref && ev.key === "F2") return ev.preventDefault(), panel.open(ref), panel.edit();
    if (ref && (ev.key === "Delete" || ev.key === "Backspace")) return ev.preventDefault(), ctx.remove(ref);
    const plain = !ev.metaKey && !ev.ctrlKey && !ev.altKey;
    if (ref && ev.key === " " && plain) return ev.preventDefault(), reply(ref);
    if (ref && /^[ad]$/i.test(ev.key) && plain) return answer(ref, /a/i.test(ev.key));
    if (/^n$/i.test(ev.key) && plain) return ev.preventDefault(), newSession();
    const pan = arrows[ev.key];
    if (pan) {
      ev.preventDefault();
      const f = ev.repeat ? 0.5 : 1;
      return ctx.panBy(pan[0] * f, pan[1] * f);
    }
    const noZoom = viewport.classList.contains("first-run-on"); // first run: nothing to zoom to (onboarding.md)
    if (noZoom && /^[+=-]$/.test(ev.key)) return;
    if (ev.key === "+" || ev.key === "=") return ctx.level(1);
    if (ev.key === "-") return ctx.level(-1);
    if (/^[wq]$/i.test(ev.key) && plain) {
      ev.preventDefault(); // the board owns W / Q: browsers with single-key shortcuts (Vivaldi) should not act on them too
      const next = nextNeeding(attention.focus, /q/i.test(ev.key) ? -1 : 1);
      if (!next) return;
      attention.hover = null; // only the element W / Q went to is lifted, not the one under the pointer
      ctx.goTo(next);
    }
  });
}

/**
 * W / Q order: the next (or previous) session or agent that needs the user after `from`, wrapping around.
 * @param {string | null} from @param {1 | -1} step @returns {string | null}
 */
export function nextNeeding(from, step = 1) {
  const needing = store.entities.filter((e) => (e.kind === "session" || e.kind === "agent") && !store.isRun(e) && needsUser(e) && !store.isArchived(e.ref));
  const frames = currentFrames();
  const list = readingOrder(needing.map((e) => ({ ref: e.ref, frame: frames.get(store.islandOf(e)), box: boxOf(e.ref) })));
  if (!list.length) return null;
  const i = list.indexOf(from ?? "");
  return list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length] ?? null;
}
