// @ts-check
// A session's pull request (ADR-0006, ADR-0014): whether it needs the user, whether the session is already fixing it,
// the "Fix and merge" / "Fix only" buttons, and whether the session is done because its PR is merged (ADR-0023).
// Used by the bubble, the detail panel and the edge hints.
import { sessionPr, sessionPrs } from "../orphan-prs.js";
import { prStack } from "../pr-stack.js";
import { store } from "../store.js";
import { ago, esc } from "../util.js";
import { CI } from "./labels.js";
import { inputAttr } from "./registry.js";

/** @typedef {import("./registry.js").Entity} Entity */

/** @param {Entity} session */
export function prOf(session) {
  const pr = sessionPr(store.related(session, "pr"));
  if (!pr) return null;
  const p = /** @type {Record<string, any>} */ (pr.data);
  const ctl = store.related(session, "control")[0];
  // while the session works on it, the PR leaves the attention set: no orange, no edge hint (ADR-0014)
  const fixing = !!pr.attention && !p.mergeable && ctl?.status === "working";
  return { pr, p, ctl, fixing, needs: !!pr.attention && !fixing, merged: pr.status === "merged" };
}

/**
 * Done (ADR-0023): its PR is merged and the session is neither working nor waiting — the user may close it.
 * @param {Entity} session
 */
export function isDone(session) {
  if (!prOf(session)?.merged) return false;
  const ctl = store.related(session, "control")[0];
  return session.status !== "working" && session.status !== "waiting" && ctl?.status !== "working" && ctl?.status !== "permission";
}

/** "CI failing · review required", or "merged · 2 h ago" @param {Record<string, any>} p */
export const prStateText = (p) =>
  p.merged ? `merged${p.base ? ` into ${p.base}` : ""} · ${ago(p.mergedAt)}` : `${CI[String(p.ci)] ?? ""}${p.mergeable ? " · ready to merge" : p.blockedReason ? ` · ${p.blockedReason}` : ""}`;

/** "Done · Remove from board" for a done session (handled by main.js with undo). @param {Entity} session */
export const doneRow = (session) =>
  isDone(session) ? `<div class="b-btns"><button class="btn quiet" data-remove="${esc(session.ref)}">Done · Remove from board</button></div>` : "";

/** What the session is told (ADR-0014: the wording is part of the product). @param {Entity} pr @param {boolean} merge */
export function fixPrompt(pr, merge) {
  const p = /** @type {Record<string, any>} */ (pr.data);
  const why = [pr.attention?.text, p.blockedReason].filter(Boolean).join(", ") || "needs a fix";
  return `PR #${p.number} (“${pr.title}”): ${why}. Please fix it${merge ? ", then squash-merge it (gh pr merge --squash --delete-branch)" : ""}.`;
}

/**
 * Buttons for a PR that needs attention and is not mergeable: the session fixes it (and merges), or a hint that an
 * observed session has to be taken over first, or a line while it is fixing.
 * @param {Entity} session
 */
export function fixRow(session) {
  const s = prOf(session);
  if (!s || s.p.mergeable || !s.pr.attention || s.p.mine === false) return ""; // a review request is not the session's to fix (ADR-0038)
  if (s.fixing) return `<div class="b-fixing">The session is fixing the PR …</div>`;
  if (!s.ctl) return `<div class="b-fixing">Take over the session so it can fix the PR.</div>`;
  const id = /** @type {any} */ (s.ctl.data).id;
  return `<div class="b-btns">
    <button class="btn" data-action="owned.send" ${inputAttr({ id, text: fixPrompt(s.pr, true) })}>Fix and merge</button>
    <button class="btn quiet" data-action="owned.send" ${inputAttr({ id, text: fixPrompt(s.pr, false) })}>Fix only</button></div>`;
}

/**
 * PR chip: number linking to GitHub, orange while it needs the user; further open PRs stacked behind (ADR-0038).
 * @param {Entity} session @param {boolean} [big]
 */
export function prChip(session, big = false) {
  const s = prOf(session);
  if (!s) return "";
  const cls = `pr-chip${big ? " big" : ""}${s.needs ? " needs" : ""}${s.merged ? " merged" : ""}`;
  return prStack({ prs: sessionPrs(store.related(session, "pr")), text: `#${s.p.number}${s.merged ? " ✓" : ""}`, cls, hint: s.merged ? "merged" : "" });
}
