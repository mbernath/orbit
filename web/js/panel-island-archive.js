// @ts-check
// "Removed from board" of one island, as a view inside the island panel (ADR-0042): back to the island, a search,
// newest first with when each was last active. A click brings the session back and shows it on the board; the list
// stays open, so several can come back in a row. Esc goes back (panel-island.js).
import { bringBack } from "./remove.js";
import { store } from "./store.js";
import { ago, closest, esc } from "./util.js";

/**
 * @param {HTMLElement} box @param {string} id the workspace id
 * @param {{ refresh: () => Promise<void>, reveal: (ref: string) => void, back: () => void }} ctx
 */
export function mountArchive(box, id, ctx) {
  box.innerHTML = `<button class="btn quiet pi-back" data-pa="back">‹ ${esc(store.workspaceName(id))}</button>
    <h4 class="pa-head"></h4>
    <input class="pa-search" placeholder="Search" aria-label="Search removed sessions" autocomplete="off" />
    <div class="pa-list"></div>`;
  const search = /** @type {HTMLInputElement} */ (box.querySelector(".pa-search"));
  const list = /** @type {HTMLElement} */ (box.querySelector(".pa-list"));
  const head = /** @type {HTMLElement} */ (box.querySelector(".pa-head"));

  const archived = () =>
    store.entities
      .filter((e) => e.kind === "session" && store.isArchived(e.ref) && store.islandOf(e) === id)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  function update() {
    const all = archived();
    const q = search.value.trim().toLowerCase();
    const shown = q ? all.filter((e) => e.title.toLowerCase().includes(q)) : all;
    head.textContent = `Removed from board · ${all.length}`;
    const html = shown.length
      ? shown.map((e) => `<button class="btn quiet pi-row pa-item" data-pa="restore" data-ref="${esc(e.ref)}" title="Bring back to the board">
          <span class="pa-title">${esc(e.title)}</span><span class="pa-when">${esc(ago(e.updatedAt))}</span></button>`).join("")
      : `<p class="p-meta">${all.length ? "No matches." : "Nothing removed from this island."}</p>`;
    if (list.dataset.html !== html) (list.innerHTML = html), (list.dataset.html = html);
  }

  search.addEventListener("input", update);
  // fields handle their own Esc (keys.js): here it goes back to the island, like Esc anywhere in this view
  search.addEventListener("keydown", (ev) => ev.key === "Escape" && (ev.stopPropagation(), ctx.back()));
  box.addEventListener("click", async (ev) => {
    const b = closest(ev.target, "[data-pa]");
    if (!b) return;
    if (b.dataset.pa === "back") return ctx.back();
    const ref = b.dataset.ref ?? "";
    await bringBack(ref);
    await ctx.refresh();
    ctx.reveal(ref);
  });
  update();
  search.focus();
  return { update };
}
