// @ts-check
// Detail panel parts for running sessions (ADR-0010, ADR-0019): for owned sessions the permission question, model and
// thinking effort, permission mode, run state and the reply field; for observed ones "Take over …" with its in-place warning.
import { runAction } from "./api.js";
import { createAttachments } from "./attach.js";
import { growField } from "./panel-size.js";
import { esc, prefs } from "./util.js";
import { runSelects } from "./views/run-options.js";
import { observedQuestion, permissionRow } from "./views/session-dot.js";

/** @typedef {import("./store.js").Entity} Entity */

/**
 * The rows between meta line and conversation.
 * @param {Entity} session @param {Entity | undefined} ctl @param {boolean} confirmTakeover
 */
export function ownedRows(session, ctl, confirmTakeover) {
  if (!ctl) return observedQuestion(session); // the take-over row sits at the bottom (observedFoot)
  const c = /** @type {Record<string, any>} */ (ctl.data);
  const state =
    ctl.status === "interrupted"
      ? "Interrupted when Orbit restarted. The next message resumes it."
      : c.error
        ? c.error
        : c.queued
          ? `${c.queued} ${c.queued === 1 ? "message queued" : "messages queued"}`
          : "";
  return state ? `<p class="p-note ${c.error ? "err" : ""}">${esc(state)}</p>` : "";
}

/**
 * For an observed session, where the reply field would be (the bottom of the panel): why there is none and
 * "Take over …" with its in-place warning; without a folder only the read-only note.
 * @param {Entity} session @param {boolean} confirmTakeover
 */
export function observedFoot(session, confirmTakeover) {
  if (!(/** @type {Record<string, any>} */ (session.data)).cwd) return `<p class="p-note p-observed">Runs outside Orbit. Read-only here.</p>`;
  return confirmTakeover
    ? `<div class="p-confirm warn"><span>If it still runs in VS Code or a terminal, two programs on one session lose messages. Close it there first.</span>
        <button class="btn" data-p="takeover-go">Take over</button><button class="btn quiet" data-p="takeover-cancel">Cancel</button></div>`
    : `<div class="p-observed"><span class="p-note">Runs outside Orbit — take it over to reply here.</span><button class="btn quiet" data-p="takeover">Take over …</button></div>`;
}

/** The permission question above the reply field and the run options below it, like a chat input. @param {Entity} ctl */
const askHtml = (ctl) => permissionRow(ctl, true);
/** @param {Entity} ctl */
const optsHtml = (ctl) => {
  const c = /** @type {Record<string, any>} */ (ctl.data);
  // open values read as the island's default (ADR-0025); the model the CLI reports once it ran wins
  const d = c.defaults ?? {};
  return runSelects(c, { ...d, model: c.runningModel ?? d.model }, "data-owned");
};

/** Wires the model and effort menus (delegated, survives re-rendering). @param {HTMLElement} root @param {() => Entity | undefined} ctl @param {() => void} onChange */
export function wireOwned(root, ctl, onChange) {
  root.addEventListener("change", async (ev) => {
    const s = /** @type {HTMLSelectElement} */ (ev.target);
    const what = s.dataset?.owned;
    const c = ctl();
    if (!what || !c) return;
    await runAction("owned.configure", { id: /** @type {any} */ (c.data).id, [what]: s.value || null });
    onChange();
  });
}

/**
 * Reply field at the bottom of the panel: Enter sends, ⇧Enter new line, ⌘Enter allows a pending request,
 * ⌘⇧Enter sends and moves on, Esc leaves — in an empty field it closes the panel.
 * @param {HTMLElement} host @param {() => Entity | undefined} ctl @param {() => void} onChange
 * @param {{ sending?: (text: string) => () => void, next?: () => void, close?: () => void }} on
 *   sending: shown at once, returns its undo; next: sent with ⌘⇧Enter; close: Esc in the empty field
 */
export function mountReply(host, ctl, onChange, on = {}) {
  const onSending = on.sending ?? (() => () => {});
  host.innerHTML = `<div class="p-ask"></div><div class="p-opts"></div><div class="p-grip" title="Drag to resize · double-click: default"></div><form class="p-reply composer"><textarea rows="2" placeholder="Reply to Claude …" aria-label="Reply"></textarea><div class="p-attach"></div></form>`;
  const ask = /** @type {HTMLElement} */ (host.querySelector(".p-ask"));
  const opts = /** @type {HTMLElement} */ (host.querySelector(".p-opts"));
  // written only on change (ADR-0022), so an open select is not replaced under the pointer
  const update = () => {
    const c = ctl();
    if (!c) return;
    const a = askHtml(c);
    if (ask.dataset.html !== a) (ask.innerHTML = a), (ask.dataset.html = a); // keeps typed answers between updates
    const o = optsHtml(c);
    if (opts.dataset.html !== o) (opts.innerHTML = o), (opts.dataset.html = o);
  };
  update();
  const ta = /** @type {HTMLTextAreaElement} */ (host.querySelector("textarea"));
  const files = createAttachments(/** @type {HTMLElement} */ (host.querySelector(".p-attach")), ta);
  const id = () => /** @type {any} */ (ctl()?.data)?.id;
  // a draft survives closing the panel and reloading the board (per session, in this browser)
  const key = () => `draft.${id()}`;
  ta.value = prefs.get(key()) ?? "";
  ta.addEventListener("input", () => prefs.set(key(), ta.value));
  const fit = growField(ta, /** @type {HTMLElement} */ (host.querySelector(".p-grip")));
  ta.addEventListener("keydown", async (ev) => {
    if (ev.key === "Escape") return ev.stopPropagation(), !ta.value.trim() && !files.list().length && on.close ? on.close() : ta.blur();
    const cmd = ev.metaKey || ev.ctrlKey;
    if (ev.key !== "Enter" || (ev.shiftKey && !cmd)) return;
    ev.preventDefault();
    const moveOn = cmd && ev.shiftKey;
    if (cmd && !moveOn) {
      if (ctl()?.status === "permission") await runAction("owned.answer", { id: id(), allow: true });
      return onChange();
    }
    const attachments = files.list();
    const text = ta.value.trim() || (attachments.length ? "See attachment." : "");
    if (!text || !id()) return;
    // shown at once, marked as on its way; the field is free again right away
    const sessionKey = key();
    const undo = onSending(text);
    ta.value = "";
    files.clear();
    fit();
    prefs.set(sessionKey, "");
    const r = await runAction("owned.send", { id: id(), text, ...(attachments.length ? { attachments } : {}) });
    if (!r.ok) {
      undo();
      ta.value = text; // nothing is lost when sending failed
      fit();
      prefs.set(sessionKey, text);
    }
    onChange();
    if (r.ok && moveOn) on.next?.();
  });
  return { focus: () => ta.focus(), update };
}
