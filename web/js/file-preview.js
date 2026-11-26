// @ts-check
// Read-only preview of a referenced file over the board (ADR-0040): images, PDFs, Markdown, code. The header offers
// Open (outside app, ADR-0030), Show in Finder and Copy path. HTML and folders skip the preview and open directly.
import { loadFilePreview, runAction } from "./api.js";
import { openDialog } from "./dialog.js";
import { renderMarkdown } from "./markdown.js";
import { closest, esc, folderOf } from "./util.js";

/** @typedef {{ path: string, base?: string | null, line?: number | null }} FileTarget */

/** the open preview (centred dialog, ADR-0042), null when closed @type {import("./dialog.js").Dialog | null} */
let dlg = null;
const OUTSIDE = /\.html?$/i; // would run with the board's origin; the browser shows it better anyway
let url = /** @type {string | null} */ (null);
let shown = /** @type {FileTarget | null} */ (null);

/** Opens the file outside Orbit, as before ADR-0040. @param {FileTarget} t @param {boolean} [reveal] */
export const openOutside = (t, reveal = false) =>
  void runAction("files.open", { path: t.path, base: t.base ?? null, line: t.line ?? null, ...(reveal ? { reveal: true } : {}) });

/** @param {FileTarget} target */
export async function openPreview(target) {
  if (OUTSIDE.test(target.path)) return openOutside(target);
  show(target, `<p class="pv-note">Loading …</p>`);
  const r = await loadFilePreview(target.path, target.base);
  if (shown !== target) return; // another preview was opened meanwhile
  if (!r.ok) {
    if (r.folder) return (close(), openOutside(target));
    const resolved = r.path ? { path: r.path, line: target.line } : target;
    const size = r.size != null ? ` · ${formatSize(r.size)}` : "";
    return show(resolved, `<p class="pv-note">${esc(r.error)}${esc(size)}</p>`, r.path != null);
  }
  const at = { path: r.path, line: target.line };
  url = URL.createObjectURL(r.blob);
  if (r.type.startsWith("image/")) show(at, `<img class="pv-img" src="${url}" alt="${esc(nameOf(r.path))}">`);
  else if (r.type === "application/pdf") show(at, `<iframe class="pv-pdf" src="${url}" title="${esc(nameOf(r.path))}"></iframe>`);
  else if (r.type.startsWith("text/markdown")) show(at, `<div class="doc-body pv-md">${renderMarkdown(await r.blob.text(), { copy: true, base: folderOf(r.path), frontmatter: "show" })}</div>`);
  else show(at, codeHtml(await r.blob.text(), target.line ?? null));
  dlg?.el.querySelector(".pv-line")?.scrollIntoView({ block: "center" });
}

/** The dialog shell, opened once per preview; its body is replaced as the file loads. */
function shell() {
  if (dlg) return dlg;
  const d = openDialog({ cls: "preview", label: "File preview", body: "", cancel: null, onClose: cleanup });
  d.el.addEventListener("click", (ev) => {
    const img = closest(ev.target, ".pv-img");
    if (img) return void img.classList.toggle("pv-full"); // fitted ↔ 100 %
    const what = closest(ev.target, "[data-pv]")?.dataset.pv;
    if (!what || !shown) return;
    if (what === "open") openOutside(shown);
    else if (what === "reveal") openOutside(shown, true);
    else if (what === "copy") void navigator.clipboard.writeText(shown.path);
    if (what === "open" || what === "reveal" || what === "close") close();
  });
  return (dlg = d);
}

/** @param {FileTarget} t @param {string} body @param {boolean} [found] whether the file exists, so Open and Finder make sense */
function show(t, body, found = true) {
  if (url && !body.includes(url)) (URL.revokeObjectURL(url), (url = null));
  shown = t;
  const off = found ? "" : " disabled";
  const box = /** @type {HTMLElement} */ (shell().el.querySelector(".dlg-body"));
  box.innerHTML = `<header class="pv-head">
      <span class="pv-name" title="${esc(t.path)}">${esc(nameOf(t.path))}${t.line ? `<span class="pv-at">:${t.line}</span>` : ""}</span>
      <button type="button" class="btn" data-pv="open"${off}>Open</button>
      <button type="button" class="btn quiet" data-pv="reveal"${off}>Show in Finder</button>
      <button type="button" class="btn quiet" data-pv="copy">Copy path</button>
      <button type="button" class="btn quiet pv-x" data-pv="close" aria-label="Close">×</button>
    </header><div class="pv-body">${body}</div>`;
  /** @type {HTMLElement} */ (box.querySelector('[data-pv="close"]')).focus();
}

/** Monospace with line numbers; the referenced line marked. @param {string} text @param {number | null} line */
function codeHtml(text, line) {
  const rows = text.replace(/\n$/, "").split("\n");
  const html = rows.map((l, i) => `<span class="pv-row${i + 1 === line ? " pv-line" : ""}"><i>${i + 1}</i>${esc(l) || " "}</span>`).join("");
  return `<pre class="pv-code">${html}</pre>`;
}

/** Closes the preview; the dialog's own close (Esc, backdrop) ends in cleanup too. */
const close = () => dlg?.close();

function cleanup() {
  dlg = null;
  shown = null;
  if (url) (URL.revokeObjectURL(url), (url = null));
}

/** @param {string} p */
const nameOf = (p) => p.split("/").filter(Boolean).pop() ?? p;
/** @param {number} n */
const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
