// @ts-check
// A session in the detail panel: editable title, Snooze/Seen in the header, meta line, PR row with in-place merge
// confirmation, run rows and take-over for owned and observed sessions (panel-owned.js), the conversation, and the
// reply field while Orbit runs it. Mounted by panel.js like the other kinds (panel-doc.js, panel-agent.js, …).
import { loadConversation, runAction } from "./api.js";
import { copySource } from "./copy.js";
import { tip } from "./key-table.js";
import { renderMarkdown } from "./markdown.js";
import { mountReply, observedFoot, ownedRows, paintActivity } from "./panel-owned.js";
import { store } from "./store.js";
import { ago, closest, esc, folderName } from "./util.js";
import { SESSION_STATUS } from "./views/labels.js";
import { locationOf, sharingWarning } from "./views/location.js";
import { doneRow, fixRow, isDone, prChip, prOf, prStateText } from "./views/pr.js";
import { controlOf } from "./views/session-dot.js";

/** @typedef {import("./store.js").Entity} Entity */
/** @typedef {{ ref: string, at: number, html: string, entries: { role: string, text: string }[] }} Conversation */

/** The user's messages on their way to Claude, shown at once until the transcript has them; kept across panel
 * switches. ref -> texts @type {Map<string, string[]>} */
const pending = new Map();
/** the conversation on screen, for "Copy as Markdown" @type {Conversation | null} */
let shown = null;
copySource("conv", (b) => shown?.entries[Number(b.dataset.i)]?.text);

/** The header part of a session: title field and the Snooze/Seen slot. */
export const sessionHead = `<input class="p-title" aria-label="Title" /><span class="p-ack"></span>`;

/**
 * @param {HTMLElement} root the panel (header and body) @param {string} ref
 * @param {{ onChange: () => void, onNext: (ref: string) => void, closeFromReply: () => void }} ctx
 */
export function mountSession(root, ref, ctx) {
  const body = /** @type {HTMLElement} */ (root.querySelector(".p-body"));
  body.innerHTML = `<div class="p-info"></div><div class="p-conv" aria-label="Conversation"></div><div class="p-foot"></div>`;
  const input = /** @type {HTMLInputElement} */ (root.querySelector(".p-title"));
  const part = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  let confirmMerge = false;
  let confirmTakeover = false;
  /** @type {{ focus: () => void, update: () => void, stop: () => Promise<void> } | null} */
  let reply = null;
  /** @type {Conversation | null} */
  let conv = null;
  let gone = false;
  const entity = () => store.byRef.get(ref);
  const control = () => {
    const e = entity();
    return e && controlOf(e);
  };

  // the title: Enter or leaving saves, Esc keeps the old one; an empty title goes back to the automatic one
  const reset = () => (input.value = entity()?.title ?? "");
  input.placeholder = /** @type {any} */ (entity()?.data).autoTitle ?? "Title";
  reset();
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") (ev.stopPropagation(), reset(), input.blur());
  });
  input.addEventListener("blur", async () => {
    const cur = /** @type {Record<string, any>} */ (entity()?.data ?? {});
    const v = input.value.trim();
    const title = v && v !== cur.autoTitle ? v : null;
    if (title === (cur.customTitle ?? null)) return void reset();
    await runAction("claude.rename", { id: cur.id, title });
    ctx.onChange();
  });

  /** @param {string} text @returns {() => void} removes it again (sending failed) */
  function addPending(text) {
    pending.set(ref, [...(pending.get(ref) ?? []), text]);
    showConversation(true);
    return () => {
      pending.set(ref, (pending.get(ref) ?? []).filter((t) => t !== text));
      showConversation(false);
    };
  }

  /** queued messages a stop took back into the reply field @param {string[]} texts */
  function dropPending(texts) {
    pending.set(ref, (pending.get(ref) ?? []).filter((t) => !texts.includes(t)));
    showConversation(false);
  }

  /** @param {Entity} e @param {number} at */
  async function fetchConversation(e, at) {
    const entries = await loadConversation(/** @type {any} */ (e.data).id);
    if (gone) return;
    // a pending message is confirmed once the transcript holds it (attachment lines may follow the text)
    const said = entries.filter((m) => m.role === "you").map((m) => m.text);
    pending.set(ref, (pending.get(ref) ?? []).filter((t) => !said.some((s) => s.startsWith(t))));
    conv = shown = { ref, at, html: conversationHtml(entries, /** @type {any} */ (e.data).cwd), entries };
    showConversation(false);
  }

  /** @param {boolean} toEnd scroll to the newest message */
  function showConversation(toEnd) {
    const box = root.querySelector(".p-conv");
    if (!box || gone) return;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const waiting = (pending.get(ref) ?? []).map((t) => `<div class="msg you pending" title="Sending to Claude …">${esc(t)}</div>`).join("");
    box.innerHTML = (conv ? conv.html.replace(`<p class="p-note">No messages yet.</p>`, waiting ? "" : "$&") : "") + waiting;
    paintActivity(/** @type {HTMLElement} */ (box), control());
    if (toEnd || atEnd || !box.scrollTop) box.scrollTop = box.scrollHeight;
  }

  /** Re-render after a store change; never touches a field the user types in. */
  function update() {
    const e = entity();
    if (!e) return;
    if (document.activeElement !== input) input.value = e.title;
    part(".p-info").innerHTML = sessionBody(e, confirmMerge, confirmTakeover);
    const ack = part(".p-ack");
    if (ack.innerHTML !== ackButton(e)) ack.innerHTML = ackButton(e);
    // reply field only while Orbit runs the session; mounted once so typed text survives updates
    const foot = part(".p-foot");
    const ctl = controlOf(e);
    if (ctl && !reply) reply = mountReply(foot, control, ctx.onChange, { sending: addPending, dropped: dropPending, next: () => ctx.onNext(ref), close: ctx.closeFromReply });
    if (!ctl && reply) (foot.innerHTML = ""), (reply = null);
    reply?.update();
    paintActivity(part(".p-conv"), ctl);
    // observed: why there is no reply field, where the user tries to type (written only on change)
    const obs = ctl ? "" : observedFoot(e, confirmTakeover);
    if (!ctl && foot.dataset.html !== obs) (foot.innerHTML = obs), (foot.dataset.html = obs);
    if (ctl) delete foot.dataset.html;
    const at = Math.max(e.updatedAt, ctl?.updatedAt ?? 0); // owned sessions also change through their control entity
    if (conv?.at !== at) fetchConversation(e, at);
  }

  body.addEventListener("click", async (ev) => {
    const b = closest(ev.target, "[data-p]");
    const what = b?.dataset.p;
    if (!b || !what) return;
    if (what === "stop") return reply?.stop();
    if (what === "merge") return (confirmMerge = true), update();
    if (what === "merge-cancel") return (confirmMerge = false), update();
    if (what === "takeover") return (confirmTakeover = true), update();
    if (what === "takeover-cancel") return (confirmTakeover = false), update();
    if (what === "takeover-go") {
      const d = /** @type {any} */ (entity()?.data);
      const r = await runAction("owned.takeover", { id: d?.id, cwd: d?.cwd }, { confirm: true });
      if (r.ok) confirmTakeover = false;
      return ctx.onChange();
    }
    if (what === "merge-go") {
      const e = entity();
      const p = /** @type {Record<string, any>} */ ((e && prOf(e)?.pr.data) ?? {});
      const methods = p.mergeMethods?.length ? p.mergeMethods : ["squash"];
      const method = methods.includes("squash") ? "squash" : methods[0];
      b.setAttribute("disabled", "");
      const r = await runAction("github.merge", { repo: p.repo, number: p.number, method, deleteBranch: true }, { confirm: true });
      if (r.ok) confirmMerge = false;
      update();
      ctx.onChange();
    }
  });

  update();
  return {
    update,
    escape: () => false,
    /** F2 / double-click: rename */
    edit: () => (input.focus(), input.select()),
    title: () => entity()?.title ?? "",
    /** the cursor into the reply field, when there is one */
    reply: () => reply?.focus(),
    unmount: () => void (gone = true),
  };
}

/** @param {Entity} e @param {boolean} confirmMerge @param {boolean} confirmTakeover */
function sessionBody(e, confirmMerge, confirmTakeover) {
  const d = /** @type {Record<string, any>} */ (e.data);
  const island = store.workspaceName(store.islandOf(e));
  const folder = folderName(d.cwd);
  const meta = [island, locationOf(e), folder !== island ? folder : null, SESSION_STATUS[e.status] ?? e.status, ago(e.updatedAt)]
    .filter(Boolean)
    .map((s) => esc(s))
    .join(" · ");
  const sharing = sharingWarning(e);
  const s = prOf(e);
  const prRow = s
    ? `<div class="p-pr">
        <div class="p-prline">${prChip(e, true)}<span>${esc(s.pr.title)}</span></div>
        <div class="p-prstate">${esc(prStateText(s.p))}</div>
        ${
          !s.pr.actions.includes("github.merge")
            ? fixRow(e) || doneRow(e)
            : confirmMerge
              ? `<div class="p-confirm"><span>Squash and merge, delete branch?</span><button class="btn" data-p="merge-go">Merge</button><button class="btn quiet" data-p="merge-cancel">Cancel</button></div>`
              : `<div class="b-btns"><button class="btn" data-p="merge">Merge …</button></div>`
        }
      </div>`
    : "";
  return `<div class="p-meta">${meta}</div>${sharing ? `<p class="p-note warn">${esc(sharing)}</p>` : ""}${ownedRows(e, controlOf(e), confirmTakeover)}${prRow}`;
}

/** "Seen" / "Snooze" as an icon in the header: it is about the whole session, not the reply, and also exists for
 * sessions without a reply field. @param {Entity} e */
function ackButton(e) {
  if (!e.actions.includes("claude.ack") || isDone(e)) return ""; // done work offers "Done" instead
  const done = e.attention?.level === "done";
  const label = tip(done ? "Seen" : "Snooze", "snooze", "panel");
  return `<button class="icon" data-action="claude.ack" data-input='${esc(JSON.stringify({ id: /** @type {any} */ (e.data).id }))}' title="${label}" aria-label="${done ? "Seen" : "Snooze"}">${done ? "✓" : "◷"}</button>`;
}

/** Messages in order; consecutive tool steps folded into one line. File references start from `cwd` (ADR-0030).
 * @param {{ role: string, text: string }[]} entries @param {string | undefined} cwd */
function conversationHtml(entries, cwd) {
  if (!entries.length) return `<p class="p-note">No messages yet.</p>`;
  let out = "";
  for (let i = 0; i < entries.length; i++) {
    const m = /** @type {{ role: string, text: string }} */ (entries[i]);
    if (m.role === "note") {
      out += `<div class="msg note">${esc(m.text)}</div>`;
      continue;
    }
    if (m.role !== "tool") {
      const copy = `<button class="icon copy" data-copy="msg" data-i="${i}" title="Copy as Markdown" aria-label="Copy as Markdown"></button>`;
      const body = m.role === "you" ? esc(m.text) : renderMarkdown(m.text, { copy: true, base: cwd });
      out += `<div class="msg ${m.role === "you" ? "you" : "ai md"}" data-copy-source="conv">${copy}${body}</div>`;
      continue;
    }
    const steps = [];
    while (entries[i]?.role === "tool") steps.push(/** @type {{ text: string }} */ (entries[i++]).text);
    i--;
    out += `<details class="steps"><summary>${steps.length === 1 ? "1 step" : `${steps.length} steps`}</summary>${steps.map((s) => `<div>${esc(s)}</div>`).join("")}</details>`;
  }
  return out;
}
