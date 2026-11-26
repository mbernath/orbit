// @ts-check
// The island in the detail panel (ADR-0042), opened by a click on its name: folders, session defaults (ADR-0025),
// clean-up (remove done / inactive from board, Tidy island, "Removed from board · n ›" as its own view), and Remove island at the
// bottom — only when empty, confirmed in place, then undo. The panel addresses it as `island:<workspace id>`.
import { runAction } from "./api.js";
import { mountArchive } from "./panel-island-archive.js";
import { visibleElements } from "./render.js";
import { NO_WS, store } from "./store.js";
import { tidy } from "./tidy.js";
import { offerUndo } from "./undo.js";
import { esc, tilde } from "./util.js";
import { isDone } from "./views/pr.js";
import { runSelects } from "./views/run-options.js";

export const ISLAND = "island:";
/** @param {string} id */
export const islandKey = (id) => `${ISLAND}${id}`;

/**
 * @param {HTMLElement} body @param {string} id the workspace id
 * @param {{ refresh: () => Promise<void>, reveal: (ref: string) => void, closed: () => void }} ctx
 */
export function mountIsland(body, id, ctx) {
  /** @type {"" | "done" | "inactive" | "remove"} the clean-up asking "really?" in place */
  let confirm = "";
  const real = id !== NO_WS;
  const ws = () => store.workspaces.find((w) => w.id === id);
  const mine = (/** @type {import("./store.js").Entity} */ e) => store.islandOf(e) === id;
  const inactive = () => visibleElements().filter((e) => e.kind === "session" && e.status === "inactive" && mine(e));
  const done = () => visibleElements().filter((e) => e.kind === "session" && isDone(e) && mine(e)); // ADR-0023
  const archived = () => store.entities.filter((e) => e.kind === "session" && store.isArchived(e.ref) && mine(e));
  const onBoard = () => visibleElements().filter(mine).length;
  const defaults = () => /** @type {{ set: import("./views/run-options.js").RunValues, claude: import("./views/run-options.js").RunValues }} */ (
    store.byRef.get(`defaults:owned/${id}`)?.data ?? { set: {}, claude: {} });

  body.innerHTML = `<div class="p-island">
      <section class="pi-folders"></section>
      ${real ? `<section><h4>New sessions</h4><div class="pi-defaults"></div><p class="p-meta">An open value follows Claude’s settings.</p></section>` : ""}
      <section><h4>Clean up</h4><div class="pi-clean"></div></section>
      ${real ? `<section class="pi-remove"></section>` : ""}
    </div><div class="p-island pi-sub" hidden></div>`;
  const main = /** @type {HTMLElement} */ (body.querySelector(".p-island"));
  const sub = /** @type {HTMLElement} */ (body.querySelector(".pi-sub"));
  /** the "Removed from board" view while it is open @type {{ update: () => void } | null} */
  let archive = null;
  const showArchive = (/** @type {boolean} */ on) => {
    main.hidden = on;
    sub.hidden = !on;
    archive = on ? mountArchive(sub, id, { refresh: ctx.refresh, reveal: ctx.reveal, back: () => showArchive(false) }) : null;
    if (!on) (sub.innerHTML = ""), update(), /** @type {HTMLElement | null} */ (main.querySelector('[data-pi="archive"]'))?.focus();
  };
  const part = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (body.querySelector(sel));
  /** writes only on change, so a focused select or button survives store updates @param {HTMLElement | null} el @param {string} html */
  const put = (el, html) => el && el.dataset.html !== html && ((el.innerHTML = html), (el.dataset.html = html));

  /** @param {string} what @param {string} text @param {number} n @param {string} ask */
  const cleanButton = (what, text, n, ask) =>
    confirm === what
      ? `<div class="p-confirm"><span>${esc(ask)}</span><button class="btn danger" data-pi="${what}-go">Remove</button><button class="btn quiet" data-pi="cancel">Cancel</button></div>`
      : `<button class="btn quiet pi-row" data-pi="${what}" ${n ? "" : "disabled"}>${esc(text)}${n ? ` · ${n}` : ""}</button>`;

  function update() {
    if (archive) return archive.update();
    const w = ws();
    put(part(".pi-folders"), w?.paths.length ? w.paths.map((p) => `<div class="pi-path" title="${esc(p)}">${esc(tilde(p))}</div>`).join("") : `<p class="p-meta">Sessions outside every island.</p>`);
    const { set, claude } = defaults();
    put(part(".pi-defaults"), runSelects(set, claude, "data-default"));
    // "Removed from board" is one row: the list is its own view, it can be long (the first run keeps older ones off)
    const d = done().length, n = inactive().length, a = archived().length;
    put(part(".pi-clean"), `${cleanButton("done", "Remove done from board", d, `Remove ${d} done from board?`)}
      ${cleanButton("inactive", "Remove inactive from board", n, `Remove ${n} inactive from board?`)}
      <button class="btn quiet pi-row" data-pi="tidy">Tidy island</button>
      <button class="btn quiet pi-row pi-more" data-pi="archive" ${a ? "" : "disabled"}>Removed from board${a ? ` · ${a}` : ""}<span aria-hidden="true">›</span></button>`);
    const left = onBoard();
    put(part(".pi-remove"), confirm === "remove" && !left
      ? `<div class="p-confirm"><span>Remove “${esc(w?.name ?? "")}”? Its folders and sessions stay untouched.</span><button class="btn danger" data-pi="remove-go">Remove</button><button class="btn quiet" data-pi="cancel">Cancel</button></div>`
      : `<button class="btn quiet pi-row pi-danger" data-pi="remove" ${left ? "disabled" : ""}>Remove island …</button>${
          left ? `<p class="p-meta">Still holds ${left} ${left === 1 ? "element" : "elements"}. Remove ${left === 1 ? "it" : "them"} from the board first.</p>` : ""}`);
  }

  /** @param {"done" | "inactive"} what */
  async function archiveGroup(what) {
    const refs = (what === "done" ? done : inactive)().map((e) => e.ref);
    confirm = "";
    await runAction("canvas.archive", { refs, archived: true });
    offerUndo({ text: `${refs.length} removed from board`, undo: async () => (await runAction("canvas.archive", { refs, archived: false }), ctx.refresh()) });
    await ctx.refresh();
  }

  async function removeIsland() {
    const w = ws();
    if (!w || onBoard()) return;
    await runAction("workspaces.remove", { id: w.id });
    ctx.closed();
    await ctx.refresh();
    offerUndo({ text: `Island “${w.name}” removed`, undo: async () => (await runAction("workspaces.add", { name: w.name, path: w.paths[0] ?? "" }), ctx.refresh()) });
  }

  body.addEventListener("click", async (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest("[data-pi]"));
    if (!b) return;
    const what = b.dataset.pi;
    if (what === "done" || what === "inactive" || what === "remove") return (confirm = what), update();
    if (what === "cancel") return (confirm = ""), update();
    if (what === "done-go" || what === "inactive-go") return archiveGroup(what === "done-go" ? "done" : "inactive");
    if (what === "remove-go") return removeIsland();
    if (what === "tidy") return tidy(id, ctx.refresh);
    if (what === "archive") return showArchive(true);
  });
  body.addEventListener("change", async (ev) => {
    const sel = /** @type {HTMLElement} */ (ev.target).closest(".pi-defaults");
    if (!sel) return;
    const values = Object.fromEntries([...sel.querySelectorAll("select")].flatMap((s) => (s.value ? [[s.dataset.default ?? "", s.value]] : [])));
    await runAction("owned.setDefaults", { workspaceId: id, ...values });
    await ctx.refresh();
  });

  update();
  return {
    update,
    /** Esc first leaves the "Removed from board" view, then drops an open confirmation */
    escape: () => (archive ? (showArchive(false), true) : confirm ? ((confirm = ""), update(), true) : false),
    edit: () => {},
    title: () => store.workspaceName(id),
  };
}
