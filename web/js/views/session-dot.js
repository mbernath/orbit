// @ts-check
// Session as a dot with name and speech bubble (docs/design/elements.md). The markup holds every depth;
// board-layout.js sets data-depth, the side of the name and the corner of the bubble.
// When Orbit runs the session itself, its related `control` entity (owned source, ADR-0019) adds the ring,
// permission requests and the running state.
import { tip } from "../key-table.js";
import { renderMarkdown } from "../markdown.js";
import { askBlock } from "./ask.js";
import { store } from "../store.js";
import { ago, esc, folderName } from "../util.js";
import { SESSION_STATUS } from "./labels.js";
import { locationOf, sharingWarning } from "./location.js";
import { doneRow, fixRow, isDone, prChip, prOf, prStateText } from "./pr.js";
import { glyphSlot, inputAttr, registerView } from "./registry.js";

/** Where the dot sits inside the element box (world units). Auto-placement spaces boxes, the dot is the anchor;
 * the box leaves room above and below the dot so a bubble fits inside the island. */
export const DOT = { x: 16, y: 80 };

/** The control entity when Orbit runs this session itself (ADR-0019), else undefined. @param {import("./registry.js").Entity} e */
export const controlOf = (e) => store.related(e, "control")[0];

/** Glyph state (elements.md): working, waiting (needs the user), done-unseen, resting. @param {import("./registry.js").Entity} e */
export function glyphState(e) {
  const ctl = controlOf(e);
  // When Orbit runs the session, its own live state wins over the hooks: after "Allow" it works again at once,
  // while the hook state still says "waiting" until the turn ends.
  if (ctl?.status === "permission") return "waiting";
  if (ctl?.status === "working") return "working";
  if (e.attention?.level === "waiting") return "waiting";
  if (isDone(e)) return "finished"; // its PR is merged: nothing left to do (ADR-0023), even if not yet seen
  if (e.attention?.level === "done") return "done";
  if (e.status === "working") return "working";
  if (e.status === "waiting") return "snoozed"; // "Snooze": still waiting, but no longer calling
  return "rest";
}

/** Whether the session shows a bubble at a depth: depth 1 only for active ones with something to say. @param {import("./registry.js").Entity} e @param {number} depth */
export function bubbleAt(e, depth) {
  if (depth < 1) return false;
  const d = /** @type {Record<string, any>} */ (e.data);
  const said = !!d.lastMessage || !!d.question; // an open question is something to say too
  const pr = prOf(e);
  if (controlOf(e)?.status === "permission") return true; // a question always shows
  // while it works, its last words were only an intermediate message: no bubble at the far levels
  if (depth === 1) return glyphState(e) !== "rest" && glyphState(e) !== "working" && (said || !!pr?.needs || glyphState(e) === "finished");
  return said || !!pr || !!e.attention;
}

/** The last statement worth showing: none while the session works (it is already past it). @param {import("./registry.js").Entity} e */
export function lastWords(e) {
  if (glyphState(e) === "working") return null;
  if (/** @type {any} */ (e.data).question && !controlOf(e)) return null; // the question row says it better
  return /** @type {string | null} */ (controlOf(e)?.data.lastText) ?? /** @type {any} */ (e.data).lastMessage ?? null;
}

/**
 * The concrete permission question of a session running elsewhere (PermissionRequest hook), read only: Orbit never
 * answers for a program it does not run (ADR-0010). @param {import("./registry.js").Entity} e
 */
export function observedQuestion(e) {
  const q = /** @type {string | null} */ (/** @type {any} */ (e.data).question);
  if (!q || controlOf(e)) return "";
  const kind = /** @type {any} */ (e.data).questionKind; // ADR-0027: a question or a plan reads as such
  const [tool, ...rest] = q.split(" ");
  // in place of the statement (same size as before), the hint only from the middle level on
  const line =
    kind === "question" ? `<b>Question:</b> ${esc(q)}`
    : kind === "plan" ? `<b>Plan to approve:</b> ${esc(q)}`
    : `Allow <b>${esc(tool ?? "")}</b>${rest.length ? ` · <code>${esc(rest.join(" "))}</code>` : ""}?`;
  return `<div class="b-said b-permq">${line}</div>
    <div class="b-meta b-permhint">Answer where the session runs, or take it over.</div>`;
}

/** "Tasks 2/5" from the session's task list while it is unfinished (ADR-0027), else "". @param {import("./registry.js").Entity} e */
export function progressText(e) {
  const p = /** @type {{ done: number, total: number } | null} */ (/** @type {any} */ (e.data).progress);
  return p && p.done < p.total ? `Tasks ${p.done}/${p.total}` : "";
}

/** Allow / Deny for a pending permission request (also used by the panel, there in full). @param {import("./registry.js").Entity | undefined} ctl @param {boolean} [full] */
export function permissionRow(ctl, full = false) {
  const p = /** @type {{ tool: string, description: string } | null | undefined} */ (ctl?.data.permission);
  if (!ctl || !p) return "";
  const ask = askBlock(ctl, full); // a question or a plan (ADR-0028)
  if (ask) return ask;
  const id = /** @type {any} */ (ctl.data).id;
  return `<div class="b-perm"><div class="b-permq">Allow <b>${esc(p.tool)}</b>${p.description ? ` · ${esc(p.description)}` : ""}?</div>
    <div class="b-btns"><button class="btn" data-action="owned.answer" ${inputAttr({ id, allow: true })}>Allow</button>
    <button class="btn quiet" data-action="owned.answer" ${inputAttr({ id, allow: false })}>Deny</button></div></div>`;
}

registerView({
  id: "dot",
  kind: "session",
  size: () => ({ w: 280, h: 160 }), // mostly bubble room; the auto-layout spaces only the slot
  anchor: DOT,
  slot: glyphSlot,
  asks: (e) => glyphState(e) === "waiting",
  bubbleAt,
  prio: (e) => (isDone(e) ? 0 : e.attention || prOf(e)?.needs || controlOf(e)?.attention ? 3 : glyphState(e) === "working" ? 2 : 0),
  className: (e) => `glyphview g-${glyphState(e)}${controlOf(e) ? " owned" : ""}`,
  render(e, el) {
    const d = /** @type {Record<string, any>} */ (e.data);
    const st = glyphState(e);
    const ctl = controlOf(e);
    const s = prOf(e);
    // depth 3: where it works and model (ADR-0017), plus the shared-checkout warning
    const model = /** @type {string | null | undefined} */ (ctl?.data.runningModel ?? ctl?.data.model);
    const where = [locationOf(e), folderName(d.cwd), model].filter(Boolean).join(" · ");
    const sharing = sharingWarning(e);
    const prRow = s
      ? `<div class="b-pr"><div class="b-prline">${prChip(e, true)}<span>${esc(prStateText(s.p))}</span></div>${
          s.pr.actions.includes("github.merge") ? `<div class="b-btns"><button class="btn" data-dialog="merge" data-ref="${esc(s.pr.ref)}">Merge …</button></div>` : fixRow(e) || doneRow(e)
        }</div>`
      : "";
    const later = e.actions.includes("claude.ack") && st !== "finished" // done work offers "Done" instead
      ? `<div class="b-btns b-act"><button class="btn quiet" data-action="claude.ack" ${inputAttr({ id: d.id })} title="${tip(st === "done" ? "Seen" : "Snooze", "snooze", "board")}">${st === "done" ? "Seen" : "Snooze"}</button></div>`
      : "";
    const said = lastWords(e);
    const edit = `data-edit="claude.rename" ${inputAttr({ id: d.id })} data-field="title" data-value="${esc(d.customTitle ?? e.title)}" data-placeholder="${esc(d.autoTitle ?? "Title")}"`;
    return `
      <div class="ui" style="left:${DOT.x}px;top:${DOT.y}px">
        <span class="glyph" data-dot></span>
        <div class="lab"><span class="lab-t" ${edit}>${esc(e.title)}</span>${prChip(e)}</div>
        <div class="bub">
          ${said ? `<div class="b-said md">${renderMarkdown(said, { base: d.cwd })}</div>` : observedQuestion(e)}
          <div class="b-meta">${esc(el?.archived ? "removed from board · " : "")}${esc(ctl?.status === "permission" ? "asking you" : SESSION_STATUS[e.status] ?? e.status)}${progressText(e) ? ` · ${progressText(e)}` : ""} · ${ago(e.updatedAt)}</div>
          <div class="b-deep">${esc(where)}</div>
          ${sharing ? `<div class="b-deep b-warn">${esc(sharing)}</div>` : ""}
          ${permissionRow(ctl)}${prRow}${later}
        </div>
      </div>`;
  },
});
