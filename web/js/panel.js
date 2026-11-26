// @ts-check
// Detail panel (docs/design/elements.md, interaction.md): opens on the right, the board narrows, the camera stays.
// Header (title, remove, full width, close) and the body module of the open kind: sessions (panel-session.js),
// documents (panel-doc.js), lists, agents, islands (ADR-0042). This file opens, closes and routes keys and clicks.
import { runAction } from "./api.js";
import { tip } from "./key-table.js";
import { mountAgent } from "./panel-agent.js";
import { mountDoc } from "./panel-doc.js";
import { ISLAND, mountIsland } from "./panel-island.js";
import { mountList } from "./panel-list.js";
import { wireOwned } from "./panel-owned.js";
import { mountSession, sessionHead } from "./panel-session.js";
import { store } from "./store.js";
import { $ } from "./util.js";
import { controlOf } from "./views/session-dot.js";

/**
 * The body of the open element.
 * @typedef {{ update: () => void, escape: () => boolean, edit: () => void, title: () => string,
 *   reply?: () => void, unmount?: () => void }} Body
 */

/**
 * @param {{ onChange: () => void, refresh: () => Promise<void>, onLayout: () => void, onRemove: (ref: string) => void,
 *   onNext: (ref: string) => void, onClosed: () => void, toggleFull: () => void, reveal: (ref: string) => void }} ctx
 *   onChange: data changed, refresh; onLayout: the board width changed; onRemove: take the element off the board;
 *   onNext: sent with ⌘⇧Enter from this element, move on; onClosed: closed from the reply field; toggleFull: ⤢
 */
export function createPanel(ctx) {
  const root = $("panel");
  /** @type {string | null} */
  let ref = null;
  /** @type {Body | null} */
  let doc = null;

  const icons = `<button class="icon" data-p="full" title="${tip("Full width", "full", "panel")}" aria-label="Full width">⤢</button>
        <button class="icon" data-p="close" title="${tip("Close", "close", "panel")}" aria-label="Close">×</button>`;

  /** Header and an empty body, shown; the island key marks the panel for hints.js before it shows. @param {string} head @param {string | null} island */
  function frame(head, island) {
    doc?.unmount?.();
    root.innerHTML = `<header class="p-head">${head}${icons}</header><div class="p-body"></div>`;
    if (island == null) delete root.dataset.island;
    else root.dataset.island = island; // hints.js: the tidy hint retires here
    root.hidden = false;
    document.body.classList.add("has-panel");
    return /** @type {HTMLElement} */ (root.querySelector(".p-body"));
  }

  function open(/** @type {string} */ next) {
    if (next === ref) return;
    ref = next;
    if (next.startsWith(ISLAND)) return openIsland(next.slice(ISLAND.length));
    const e = store.byRef.get(next);
    if (!e) return close();
    const removeLabel = e.kind === "session" || e.kind === "agent" ? "Remove from board" : "Unpin";
    const remove = `<button class="icon" data-p="remove" title="${tip(removeLabel, "remove-open", "panel")}" aria-label="${removeLabel}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/></svg></button>`;
    const body = frame(`${e.kind === "session" ? sessionHead : `<h2 class="p-title-ro"></h2>`}${remove}`, null);
    if (e.kind === "file") doc = mountDoc(body, next, ctx.refresh);
    else if (e.kind === "list") doc = mountList(body, next, ctx);
    else if (e.kind === "agent") doc = mountAgent(body, next, { refresh: ctx.refresh, openRun: open, deleted: () => (close(), ctx.onChange()) });
    else doc = mountSession(root, next, { onChange: ctx.onChange, onNext: ctx.onNext, closeFromReply: () => (close(), ctx.onClosed()) });
    update();
    ctx.onLayout();
  }

  /** The island panel (ADR-0042): its name is the title field, the body is panel-island.js. @param {string} id */
  function openIsland(id) {
    const ws = store.workspaces.find((w) => w.id === id);
    const body = frame(ws ? `<input class="p-title" aria-label="Island name" />` : `<h2 class="p-title-ro"></h2>`, id);
    doc = mountIsland(body, id, { refresh: ctx.refresh, reveal: ctx.reveal, closed: close });
    const input = /** @type {HTMLInputElement | null} */ (root.querySelector(".p-title"));
    if (input && ws) {
      const reset = () => (input.value = store.workspaceName(id));
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") (ev.stopPropagation(), reset(), input.blur());
      });
      input.addEventListener("blur", async () => {
        const name = input.value.trim();
        if (!name || name === store.workspaceName(id)) return void reset();
        await runAction("workspaces.rename", { id, name });
        ctx.onChange();
      });
      reset();
    }
    update();
    ctx.onLayout();
  }

  function close() {
    if (!ref) return;
    ref = null;
    doc?.unmount?.();
    doc = null;
    root.hidden = true;
    delete root.dataset.island;
    root.innerHTML = "";
    document.body.classList.remove("has-panel");
    ctx.onLayout();
  }

  /** Re-render after a store change; never touches a field the user types in. */
  function update() {
    if (!ref) return;
    if (ref.startsWith(ISLAND)) {
      const id = ref.slice(ISLAND.length);
      if (!store.islands().includes(id)) return close(); // removed meanwhile
      const name = /** @type {HTMLInputElement | null} */ (root.querySelector(".p-title"));
      if (name && document.activeElement !== name) name.value = store.workspaceName(id);
    } else if (!store.byRef.get(ref)) return close();
    const ro = /** @type {HTMLElement | null} */ (root.querySelector(".p-title-ro"));
    if (ro && doc) ro.textContent = doc.title();
    doc?.update();
  }

  // owned sessions: Allow / Deny, answers and run options in the panel (panel-owned.js), on the open one
  wireOwned(root, () => {
    const e = ref ? store.byRef.get(ref) : undefined;
    return e && controlOf(e);
  }, ctx.onChange);

  // ⌘⇧⌫ takes the open element off the board, also while typing (plain ⌫ belongs to the text there)
  document.addEventListener("keydown", (ev) => {
    if (!ref || ref.startsWith(ISLAND) || ev.key !== "Backspace" || !(ev.metaKey || ev.ctrlKey) || !ev.shiftKey) return;
    ev.preventDefault();
    ctx.onRemove(ref);
  });

  root.addEventListener("click", (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest(".p-head [data-p]"));
    if (!b || !ref) return;
    const what = b.dataset.p;
    if (what === "close") return close();
    if (what === "full") return ctx.toggleFull();
    if (what === "remove") return ctx.onRemove(ref);
  });

  return {
    open,
    close,
    update,
    isOpen: () => !!ref,
    current: () => ref,
    /** put the cursor into the reply field, when there is one */
    reply: () => doc?.reply?.(),
    /** Esc: the innermost thing first (an open editor), then the panel. @returns {boolean} whether Esc was used */
    escape() {
      if (!ref) return false;
      if (doc?.escape()) return true;
      close();
      return true;
    },
    /** F2 / double-click: rename a session or an island, edit a document */
    edit() {
      if (doc && !ref?.startsWith(ISLAND)) return doc.edit();
      const input = /** @type {HTMLInputElement | null} */ (root.querySelector(".p-title"));
      input?.focus();
      input?.select();
    },
  };
}
