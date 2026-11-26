// @ts-check
// Stage 1 of the first run (docs/design/onboarding.md, ADR-0041): with no island yet, the empty board offers the
// folders Claude Code was used in. One click adds the island through workspaces.add; the import then fills it.
import { loadFolders, runAction } from "./api.js";
import { installImportChoice, keepRecent, placeImportLine } from "./import-choice.js";
import { store } from "./store.js";
import { $, ago, esc, tilde } from "./util.js";

/** @typedef {import("../../src/core/types").FolderSuggestion} FolderSuggestion */

/** @type {FolderSuggestion[] | null} null until loaded for the current empty board */
let folders = null;
let loading = false;
/** @type {{ added: (id: string) => Promise<unknown>, chooseOther: (anchor: HTMLElement) => void, refresh: () => Promise<unknown> }} */
let ctx = { added: async () => {}, chooseOther: () => {}, refresh: async () => {} };


function html() {
  const list = folders ?? [];
  const rows = list.map((f, i) => `<button class="fr-folder" data-i="${i}"><b>${esc(f.name)}</b><span class="fr-path">${esc(tilde(f.path))}</span><span class="fr-meta">${f.sessions} session${f.sessions === 1 ? "" : "s"}${f.recent ? `, ${f.recent} this week` : ""} · ${esc(ago(f.lastUsed))}</span></button>`);
  return `<p class="fr-lead">All your Claude Code sessions in one place — and the ones that need you.</p>
    ${list.length ? `<p class="fr-start">Start with a project you work in:</p><div class="fr-list">${rows.join("")}</div>` : ""}
    <button class="fr-other" data-other>${list.length ? "Choose another folder …" : "Choose a folder …"}</button>`;
}

/** @param {HTMLElement} box */
function draw(box) {
  const next = html();
  if (box.dataset.html !== next) (box.innerHTML = next), (box.dataset.html = next);
}

/** Wire once. @param {typeof ctx} c */
export function installFirstRun(c) {
  ctx = c;
  installImportChoice({ refresh: c.refresh });
  const box = $("first-run");
  box.addEventListener("click", async (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.closest("[data-other]")) return ctx.chooseOther(/** @type {HTMLElement} */ (t.closest("[data-other]")));
    const b = /** @type {HTMLElement | null} */ (t.closest(".fr-folder"));
    const f = b && folders?.[Number(b.dataset.i)];
    if (!f) return;
    const r = await runAction("workspaces.add", { name: f.name, path: f.path });
    if (!r.ok) return;
    await ctx.added(r.data.id); // the board now has the imported sessions
    await keepRecent(r.data.id); // stage 1b: only the recent ones stay on the board
  });
}

/** Called with every board render: shown only while there is no island. */
export function renderFirstRun() {
  placeImportLine();
  const box = $("first-run");
  const show = store.workspaces.length === 0;
  if (box.hidden !== !show) box.hidden = !show;
  // without islands the board chrome means nothing: style.css hides it, keys.js and canvas.js ignore zoom input
  $("viewport").classList.toggle("first-run-on", show);
  if (!show) return void (folders = null); // read again if the last island is removed
  if (folders) return draw(box);
  if (loading) return;
  loading = true;
  loadFolders().then((f) => {
    loading = false;
    folders = f;
    draw(box);
  });
}
