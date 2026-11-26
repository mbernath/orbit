// @ts-check
// Picker for pinning a Markdown file onto the canvas (ADR-0011), centred dialog (ADR-0042).
import { loadFileCandidates, runAction } from "../api.js";
import { openDialog } from "../dialog.js";
import { store } from "../store.js";
import { closest, esc } from "../util.js";

/** @param {(ref: string) => void} done called with the ref of the pinned file */
export async function openFilePicker(done) {
  const d = openDialog({
    cls: "file-dialog",
    title: "Pin file",
    sub: "Markdown files from your islands. Pinned files appear on the board and can be edited.",
    body: `<input class="file-search" placeholder="Search, e.g. roadmap" autocomplete="off" aria-label="Search" />
      <div class="file-list"><p class="empty">Loading …</p></div>`,
    cancel: "Close",
  });
  const search = /** @type {HTMLInputElement} */ (d.el.querySelector(".file-search"));
  const list = /** @type {HTMLElement} */ (d.el.querySelector(".file-list"));
  /** @type {{ workspaceId: string, path: string, rel: string }[]} */
  let candidates = [];

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const pinned = new Set(store.entities.filter((e) => e.kind === "file").map((e) => String(e.data.path)));
    const shown = candidates.filter((c) => !q || c.rel.toLowerCase().includes(q)).slice(0, 200);
    let group = "";
    list.innerHTML = shown.length
      ? shown
          .map((c) => {
            const head = c.workspaceId !== group ? `<div class="file-group">${esc(store.workspaceName((group = c.workspaceId)))}</div>` : "";
            const isPinned = pinned.has(c.path);
            return `${head}<button type="button" class="file-item" data-pin="${esc(c.path)}"${isPinned ? " disabled" : ""}>
              ${esc(c.rel)}${isPinned ? ' <span class="pinned">pinned</span>' : ""}</button>`;
          })
          .join("")
      : `<p class="empty">${candidates.length ? "No matches." : "No Markdown files found on your islands."}</p>`;
  };

  search.addEventListener("input", paint);
  // Enter in the search pins the first match
  search.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    /** @type {HTMLButtonElement | null} */ (list.querySelector(".file-item:not(:disabled)"))?.click();
  });
  list.addEventListener("click", async (ev) => {
    const item = closest(ev.target, "[data-pin]");
    if (!item) return;
    const r = await runAction("files.pin", { path: item.dataset.pin ?? "" }, { quiet: true });
    if (!r.ok) return d.error(r.error);
    d.close();
    done(r.data.ref);
  });
  candidates = await loadFileCandidates();
  paint();
}
