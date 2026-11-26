// @ts-check
// The one dialog component (ADR-0042): native <dialog> in the top layer, so focus stays inside and Esc closes.
// Two placements: anchored at the control that opened it (forms behind "+") or centred over a dimmed board.
// Title, optional subline, body, error line, then Cancel and the primary button on the right.
import { closest, esc } from "./util.js";

/**
 * @typedef {{
 *   title?: string, sub?: string, label?: string, body: string, submit?: string, cancel?: string | null, cls?: string,
 *   anchor?: HTMLElement | { x: number, y: number } | null,
 *   onSubmit?: (form: HTMLFormElement) => Promise<string | void> | string | void,
 *   onClose?: () => void,
 * }} DialogOptions
 *   title: HTML (callers escape); body: HTML; submit: the primary button's text (none without it);
 *   onSubmit: returns an error text to keep the dialog open, nothing to close it
 * @typedef {{ el: HTMLDialogElement, form: HTMLFormElement, close: () => void, error: (msg: string | null) => void,
 *   busy: (label: string | null) => void }} Dialog
 */

/** @type {Dialog | null} */
let current = null;

/** Whether a dialog is open (hints and keys keep quiet then). */
export const dialogOpen = () => !!current;

/** @param {DialogOptions} o @returns {Dialog} */
export function openDialog(o) {
  current?.close();
  const el = document.createElement("dialog");
  el.className = `dlg ${o.anchor ? "anchored" : "centred"}${o.cls ? ` ${o.cls}` : ""}`;
  if (o.label) el.setAttribute("aria-label", o.label);
  const cancel = o.cancel === undefined ? "Cancel" : o.cancel;
  const actions = o.submit || cancel
    ? `<div class="dlg-actions">${cancel ? `<button type="button" class="btn quiet" data-dlg="cancel">${esc(cancel)}</button>` : ""}${
        o.submit ? `<button type="submit" class="btn primary">${esc(o.submit)}</button>` : ""}</div>`
    : "";
  el.innerHTML = `<form class="dlg-form" novalidate>
      ${o.title ? `<h3 class="dlg-title">${o.title}</h3>` : ""}${o.sub ? `<p class="dlg-sub">${esc(o.sub)}</p>` : ""}
      <div class="dlg-body">${o.body}</div><p class="error" hidden></p>${actions}</form>`;
  const form = /** @type {HTMLFormElement} */ (el.querySelector("form"));
  const err = /** @type {HTMLElement} */ (el.querySelector(".error"));
  const primary = /** @type {HTMLButtonElement | null} */ (el.querySelector("button[type=submit]"));
  const primaryText = primary?.textContent ?? "";
  let closed = false;

  /** @type {Dialog} */
  const d = {
    el,
    form,
    close() {
      if (closed) return;
      closed = true;
      if (el.open) el.close();
      el.remove();
      if (current === d) current = null;
      o.onClose?.();
    },
    error(msg) {
      err.textContent = msg ?? "";
      err.hidden = !msg;
    },
    busy(label) {
      if (!primary) return;
      primary.disabled = label != null;
      primary.textContent = label ?? primaryText;
    },
  };
  current = d;

  el.addEventListener("close", () => d.close()); // Esc (the browser closes a modal dialog itself)
  el.addEventListener("click", (ev) => {
    if (closest(ev.target, '[data-dlg="cancel"]')) return d.close();
    // a click on the backdrop lands on the dialog element itself, outside its box
    if (ev.target !== el) return;
    const r = el.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) d.close();
  });
  // Enter in a text field submits, ⇧Enter is a new line (like every reply field)
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") return void ev.stopPropagation(); // closes only this, not the panel behind it
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.target instanceof HTMLTextAreaElement && primary)
      (ev.preventDefault(), form.requestSubmit());
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!o.onSubmit || primary?.disabled) return;
    if (!form.checkValidity()) return void /** @type {HTMLElement | null} */ (form.querySelector(":invalid"))?.focus();
    d.error(null);
    d.busy(primaryText ? `${primaryText} …` : "…");
    const msg = await o.onSubmit(form);
    if (closed) return;
    d.busy(null);
    if (msg) return d.error(msg);
    d.close();
  });

  document.body.append(el);
  el.showModal();
  if (o.anchor) place(el, o.anchor);
  const first = /** @type {HTMLElement | null} */ (el.querySelector(".dlg-body :is(input:not([type=hidden]):not([type=checkbox]), textarea, select)")) ?? primary;
  first?.focus();
  return d;
}

/** Below the control, kept inside the window. @param {HTMLDialogElement} el @param {HTMLElement | { x: number, y: number }} anchor */
function place(el, anchor) {
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y };
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8))}px`;
}
