// @ts-check
// Questions and plans of owned sessions (ADR-0028): options to pick, a plan to approve. The bubble shows the short
// form; the panel (full) adds the plan text and free-text answers. Buttons are plain data-action buttons; those with
// data-collect get the fields of their block merged into the input (main.js).
import { renderMarkdown } from "../markdown.js";
import { esc } from "../util.js";
import { inputAttr } from "./registry.js";

/** @typedef {{ question: string, header: string, multiSelect: boolean, options: { label: string, description: string }[] }} Question */

/** @param {string} id @param {Question[]} qs @param {boolean} full */
function questionBlock(id, qs, full) {
  const oneClick = qs.length === 1 && !qs[0]?.multiSelect; // one question, one choice: a click answers
  const body = qs
    .map((q, i) => {
      const opts = q.options
        .map((o) =>
          oneClick
            ? `<button class="btn" data-action="owned.answer" ${inputAttr({ id, allow: true, answers: { [q.question]: o.label } })} title="${esc(o.description)}">${esc(o.label)}</button>`
            : `<label class="b-opt" title="${esc(o.description)}"><input type="${q.multiSelect ? "checkbox" : "radio"}" name="q${i}" value="${esc(o.label)}"> ${esc(o.label)}</label>`,
        )
        .join("");
      const other = full ? `<input class="b-other" data-other placeholder="Other answer …" aria-label="Other answer">` : "";
      return `<div class="b-q" data-q="${esc(q.question)}"><div class="b-permq"><b>Question:</b> ${esc(q.question)}</div><div class="b-btns">${opts}</div>${other}</div>`;
    })
    .join("");
  const send = !oneClick || full ? `<button class="btn" data-action="owned.answer" data-collect ${inputAttr({ id, allow: true })}>Answer</button>` : "";
  return `<div class="b-perm b-ask" data-ask>${body}<div class="b-btns">${send}
    <button class="btn quiet" data-action="owned.answer" ${inputAttr({ id, allow: false, message: "The user declined to answer the question." })}>Decline</button></div></div>`;
}

/** @param {string} id @param {string | null} plan @param {boolean} full */
function planBlock(id, plan, full) {
  const first = (plan ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
  const text = full && plan ? `<div class="md b-plantext">${renderMarkdown(plan)}</div>` : first ? `<div>${esc(first)}</div>` : "";
  const feedback = full ? `<input class="b-other" data-message placeholder="What should change? (when rejecting)" aria-label="Plan feedback">` : "";
  return `<div class="b-perm b-ask" data-ask><div class="b-permq"><b>Plan to approve</b></div>${text}${feedback}
    <div class="b-btns"><button class="btn" data-action="owned.answer" ${inputAttr({ id, allow: true })}>Approve</button>
    <button class="btn quiet" data-action="owned.answer" data-collect ${inputAttr({ id, allow: false, message: "The user rejected the plan." })}>Reject</button></div></div>`;
}

/**
 * The block for a pending question or plan, "" for a plain permission.
 * @param {import("./registry.js").Entity | undefined} ctl @param {boolean} full
 */
export function askBlock(ctl, full) {
  const p = /** @type {{ kind?: string, questions?: Question[] | null, plan?: string | null } | null | undefined} */ (ctl?.data.permission);
  if (!ctl || !p) return "";
  const id = /** @type {any} */ (ctl.data).id;
  if (p.kind === "question" && p.questions?.length) return questionBlock(id, p.questions, full);
  if (p.kind === "plan") return planBlock(id, p.plan ?? null, full);
  return "";
}

/** The fields of a block as extra input: chosen answers per question, or a plan's feedback. @param {HTMLElement} button */
export function collectAsk(button) {
  const block = button.closest("[data-ask]");
  if (!block) return {};
  const message = /** @type {HTMLInputElement | null} */ (block.querySelector("[data-message]"))?.value.trim();
  if (message) return { message };
  /** @type {Record<string, string>} */
  const answers = {};
  for (const q of block.querySelectorAll("[data-q]")) {
    const other = /** @type {HTMLInputElement | null} */ (q.querySelector("[data-other]"))?.value.trim();
    const picked = [...q.querySelectorAll("input:checked")].map((i) => /** @type {HTMLInputElement} */ (i).value);
    const answer = other || picked.join(", "); // several options joined like the CLI's own dialog
    if (answer) answers[/** @type {HTMLElement} */ (q).dataset.q ?? ""] = answer;
  }
  return Object.keys(answers).length ? { answers } : {};
}
