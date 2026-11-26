// @ts-check
// List node (ADR-0036, elements.md "List"): a glyph with its title; the bubble grows with the depth —
// 1: one summary line, 2: the first section with open items and the others as one line each, 3: all sections with
// children one level deep. The script's order is kept everywhere; blocked items are marked, never moved.
import { ago, esc } from "../util.js";
import { glyphSlot, registerView } from "./registry.js";

/** @typedef {import("../../../src/sources/lists/contract").ListItem} ListItem */
/** @typedef {import("../../../src/sources/lists/contract").ListDoc} ListDoc */
/** @typedef {import("../../../src/sources/lists/contract").Derived} Derived */
/**
 * @typedef {{ id: string, command: string, title: string | null, interval: number, list: ListDoc | null,
 *   derived: Derived | null, fetchedAt: number | null, error: string | null, errorAt: number | null, running: boolean }} ListData
 */

/** @param {import("./registry.js").Entity} e */
export const listData = (e) => /** @type {ListData} */ (e.data);

/** @type {Record<string, string>} */
const STATE_WORD = { open: "open", active: "in progress", blocked: "blocked", done: "done" };

/** done/total of the direct children, or "" @param {ListItem} i */
const progress = (i) => (i.children.length ? `${i.children.filter((c) => c.state === "done").length}/${i.children.length}` : "");

/** @param {ListItem["badges"]} badges */
export const badgesHtml = (badges) => badges.map((b) => `<span class="l-badge tone-${esc(b.tone)}">${esc(b.text)}</span>`).join("");

/**
 * One row: state dot, title (a link when there is a url), progress, badges.
 * @param {ListItem} i @param {{ badges?: boolean }} [o]
 */
export function itemRow(i, o = {}) {
  const title = i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title);
  const p = progress(i);
  return `<div class="l-item st-${esc(i.state)}" title="${esc(i.stateLabel ?? STATE_WORD[i.state] ?? "")}">
    <span class="l-dot" aria-label="${esc(STATE_WORD[i.state] ?? "")}"></span>${i.ref ? `<button class="l-ref" data-copy="text" data-copy-text="${esc(i.ref)}" title="Copy">${esc(i.ref)}</button>` : ""}<span class="l-title">${title}</span>
    ${p ? `<span class="l-prog">${p}</span>` : ""}${o.badges && i.badges.length ? `<span class="l-badges">${badgesHtml(i.badges)}</span>` : ""}</div>`;
}

/** The summary line: the script's own, else counts per section, blocked in red. @param {ListData} d */
export function summaryHtml(d) {
  if (d.list?.summary) return `<span class="tone-${esc(d.list.summary.tone)}">${esc(d.list.summary.text)}</span>`;
  if (!d.derived) return "";
  const counts = d.derived.sections.map((s) => (s.title ? `${esc(s.title)} ${s.open}` : `${s.open} open`)).join(" · ");
  return `${counts}${d.derived.blocked ? ` · <span class="tone-bad">${d.derived.blocked} blocked</span>` : ""}`;
}

/** "Updated 4 min ago" plus the failure, if the last run failed @param {ListData} d */
export function standHtml(d) {
  if (d.running && !d.fetchedAt) return "Loading …";
  const stand = d.fetchedAt ? `Updated ${esc(ago(d.fetchedAt))}` : "";
  return d.error ? `<span class="b-warn" title="${esc(d.error)}">⚠ ${stand || "Failed"}</span>` : stand;
}

/** depth 2: the first section with something open, its first five open items; the other sections as one line @param {ListDoc} list */
function shortHtml(list) {
  const first = list.sections.find((s) => s.items.some((i) => i.state !== "done"));
  if (!first) return `<p class="b-meta">Nothing open.</p>`;
  const open = first.items.filter((i) => i.state !== "done");
  const rest = list.sections.filter((s) => s !== first).map((s) => `${esc(s.title || "Other")} · ${s.items.filter((i) => i.state !== "done").length}`);
  return `${first.title ? `<div class="l-sec">${esc(first.title)}</div>` : ""}
    ${open.slice(0, 5).map((i) => itemRow(i)).join("")}${open.length > 5 ? `<div class="l-more">+ ${open.length - 5} more</div>` : ""}
    ${rest.length ? `<div class="l-rest">${rest.join("<br>")}</div>` : ""}`;
}

/** depth 3: every section; collapsed ones as a heading with a count; children one level, done ones hidden @param {ListDoc} list */
function fullHtml(list) {
  return list.sections
    .map((s) => {
      const open = s.items.filter((i) => i.state !== "done");
      const head = s.title ? `<div class="l-sec">${esc(s.title)}${s.collapsed ? ` · ${open.length}` : ""}</div>` : "";
      if (s.collapsed) return head;
      return `${head}${open
        .map((i) => `${itemRow(i, { badges: true })}${i.children.filter((c) => c.state !== "done").map((c) => `<div class="l-child">${itemRow(c)}</div>`).join("")}`)
        .join("")}`;
    })
    .join("");
}

registerView({
  id: "list",
  kind: "list",
  size: () => ({ w: 280, h: 160 }),
  anchor: { x: 16, y: 80 },
  slot: glyphSlot,
  bubbleAt: (e, depth) => depth >= 1 && (listData(e).list != null || !!listData(e).error),
  prio: () => 1,
  className: (e) => `glyphview g-list${listData(e).derived?.blocked ? " g-blocked" : ""}${listData(e).error ? " g-stale" : ""}`,
  render(e) {
    const d = listData(e);
    return `
      <div class="ui" style="left:16px;top:80px">
        <span class="glyph listg" data-dot><i></i></span>
        <div class="lab"><span class="lab-t">${esc(e.title)}</span></div>
        <div class="bub list-bub">
          ${d.list ? `<div class="b-sum">${summaryHtml(d)}</div><div class="l-short">${shortHtml(d.list)}</div><div class="l-full">${fullHtml(d.list)}</div>` : `<div class="b-sum b-warn">${esc(d.error ?? "")}</div>`}
          <div class="b-meta">${standHtml(d)}</div>
        </div>
      </div>`;
  },
});
