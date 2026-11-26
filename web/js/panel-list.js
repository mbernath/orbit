// @ts-check
// List body of the detail panel (ADR-0036): the whole tree with notes and badges, a filter by state, "Refresh",
// the failure of the last run, and the node's settings (command, title, interval). Same interface as panel-doc.js.
import { runAction } from "./api.js";
import { store } from "./store.js";
import { esc } from "./util.js";
import { itemRow, listData, standHtml, summaryHtml } from "./views/list-node.js";

/** @typedef {import("./views/list-node.js").ListItem} ListItem */

export const INTERVALS = [[60, "every minute"], [300, "every 5 min"], [900, "every 15 min"], [3600, "hourly"], [0, "manually only"]];
/** @param {number} sel */
export const intervalOptions = (sel) => INTERVALS.map(([v, t]) => `<option value="${v}"${v === sel ? " selected" : ""}>${t}</option>`).join("");

const FILTERS = [["all", "All"], ["open", "Open"], ["blocked", "Blocked"], ["done", "Done"]];
/** @param {string} f @param {ListItem} i */
const passes = (f, i) => f === "all" || (f === "open" ? i.state !== "done" : i.state === f);

/**
 * @param {HTMLElement} host
 * @param {string} ref
 * @param {{ refresh: () => Promise<void> }} ctx
 */
export function mountList(host, ref, ctx) {
  const entity = () => store.byRef.get(ref);
  let filter = "open";
  host.innerHTML = `
    <div class="p-info p-list">
      <p class="p-meta l-summary"></p>
      <div class="l-bar"><span class="l-filters"></span><button class="btn quiet" data-l="refresh">Refresh</button></div>
      <p class="p-note err" hidden></p>
    </div>
    <div class="p-conv l-tree" aria-label="List"></div>
    <details class="p-info l-settings"><summary>Settings</summary>
      <label class="p-field">Command<input data-l="command" spellcheck="false" /></label>
      <label class="p-field">Title<input data-l="title" /></label>
      <label class="p-field">Refresh<select data-l="interval"></select></label>
    </details>`;
  const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (host.querySelector(s));
  const field = (/** @type {string} */ k) => /** @type {HTMLInputElement} */ (q(`[data-l="${k}"]`));

  /** @param {ListItem} i @returns {string} filtered subtree; a parent stays when a child matches */
  const tree = (i) => {
    const kids = i.children.map(tree).join("");
    if (!passes(filter, i) && !kids) return "";
    return `<div class="l-node">${itemRow(i, { badges: true })}${i.note ? `<p class="l-note">${esc(i.note)}</p>` : ""}${kids ? `<div class="l-kids">${kids}</div>` : ""}</div>`;
  };

  function update() {
    const e = entity();
    if (!e) return;
    const d = listData(e);
    q(".l-summary").innerHTML = `${summaryHtml(d)}${summaryHtml(d) ? " · " : ""}${standHtml(d)}`;
    q(".l-filters").innerHTML = FILTERS.map(([v, t]) => `<button class="chip${v === filter ? " on" : ""}" data-l="filter" data-v="${v}">${t}</button>`).join("");
    const err = q(".err");
    err.hidden = !d.error;
    err.textContent = d.error ? `Last run failed: ${d.error}` : "";
    /** @type {HTMLButtonElement} */ (q('[data-l="refresh"]')).disabled = d.running;
    const sections = d.list?.sections ?? [];
    const html = sections
      .map((s) => {
        const body = s.items.map(tree).join("");
        return body || s.title ? `${s.title ? `<div class="l-sec">${esc(s.title)}</div>` : ""}${body || `<p class="p-note">No items.</p>`}` : "";
      })
      .join("");
    q(".l-tree").innerHTML = html || `<p class="p-note">No items.</p>`;
    // never overwrite a settings field the user is typing in
    if (!host.contains(document.activeElement) || !q(".l-settings").contains(document.activeElement)) {
      field("command").value = d.command;
      field("title").value = d.title ?? "";
      field("title").placeholder = d.list?.title ?? "List";
      q('[data-l="interval"]').innerHTML = intervalOptions(d.interval);
    }
  }

  const save = async () => {
    const d = listData(/** @type {any} */ (entity()));
    const command = field("command").value.trim(), title = field("title").value.trim();
    const interval = Number(/** @type {HTMLSelectElement} */ (q('[data-l="interval"]')).value);
    if (!command || (command === d.command && title === (d.title ?? "") && interval === d.interval)) return update();
    await runAction("lists.update", { id: d.id, command, title, interval });
    await ctx.refresh();
  };
  for (const k of ["command", "title"]) {
    field(k).addEventListener("blur", save);
    field(k).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") field(k).blur();
      if (ev.key === "Escape") (ev.stopPropagation(), field(k).blur());
    });
  }
  q('[data-l="interval"]').addEventListener("change", save);

  host.addEventListener("click", async (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest("button[data-l]"));
    if (!b) return;
    if (b.dataset.l === "filter") return (filter = b.dataset.v ?? "all"), update();
    if (b.dataset.l === "refresh") {
      b.setAttribute("disabled", "");
      await runAction("lists.refresh", { id: listData(/** @type {any} */ (entity())).id }, { quiet: true });
      await ctx.refresh();
    }
  });

  update();
  return {
    update,
    escape: () => false,
    edit: () => field("command").focus(),
    title: () => entity()?.title ?? "",
  };
}
