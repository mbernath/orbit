// @ts-check
// Document body of the detail panel: rendered Markdown; a click into the text switches to the source.
// ⌘S or leaving the field saves, Esc discards. Saving sends the hash it was loaded with (ADR-0011); when the file
// changed meanwhile, the user chooses: reload (drops their edit) or overwrite.
import { runAction } from "./api.js";
import { renderMarkdown } from "./markdown.js";
import { store } from "./store.js";
import { folderOf } from "./util.js";

/** @typedef {{ path: string, rel: string, content: string | null, hash: string | null }} FileData */

/**
 * @param {HTMLElement} host
 * @param {string} ref
 * @param {() => Promise<void>} refresh loads the current state (after saving, and before overwriting)
 */
export function mountDoc(host, ref, refresh) {
  const data = () => /** @type {FileData | undefined} */ (store.byRef.get(ref)?.data);
  /** @type {{ text: string, baseHash: string } | null} while editing */
  let editing = null;
  let conflict = false;
  /** content key of what the rendered view shows; null after the editor replaced it */
  let shown = /** @type {string | null} */ (null);

  function show() {
    const d = data();
    if (!d) return;
    if (!editing) {
      // refreshes arrive every 30 s and on every push: re-rendering the same text would reset the scroll position
      const key = `${d.hash}\n${d.content == null}`;
      if (shown === key && host.querySelector(".p-doc, .p-note")) return;
      shown = key;
      host.innerHTML =
        d.content == null
          ? `<p class="p-note">The file is too large or cannot be read.</p>`
          : `<div class="doc-body p-doc" tabindex="0" title="Click to edit">${renderMarkdown(d.content, { copy: true, base: folderOf(d.path), frontmatter: "show" })}</div>`;
      return;
    }
    if (host.querySelector("textarea")) return showConflict(); // never replace the field the user types in
    host.innerHTML = `<div class="p-conflict" hidden></div><textarea class="p-src" spellcheck="false" aria-label="Markdown"></textarea>
      <p class="p-hint">⌘S saves · Esc discards</p>`;
    const ta = /** @type {HTMLTextAreaElement} */ (host.querySelector("textarea"));
    ta.value = editing.text;
    ta.focus();
    ta.addEventListener("input", () => editing && (editing.text = ta.value));
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "s" && (ev.metaKey || ev.ctrlKey)) (ev.preventDefault(), save(false));
      if (ev.key === "Escape") (ev.stopPropagation(), discard());
    });
    ta.addEventListener("blur", (ev) => {
      if (!host.contains(/** @type {Node | null} */ (ev.relatedTarget))) save(false);
    });
    showConflict();
  }

  function showConflict() {
    const bar = /** @type {HTMLElement | null} */ (host.querySelector(".p-conflict"));
    if (!bar) return;
    bar.hidden = !conflict;
    bar.innerHTML = conflict
      ? `<span>The file has changed meanwhile.</span>
         <button class="btn quiet" data-doc="reload">Reload</button><button class="btn" data-doc="overwrite">Save anyway</button>`
      : "";
  }

  /** @param {boolean} overwrite */
  async function save(overwrite) {
    if (overwrite) await refresh(); // overwrite what is on disk now, not an older version
    const d = data();
    if (!editing || !d) return;
    if (!overwrite && !conflict && editing.text === d.content) return discard();
    const baseHash = overwrite ? d.hash ?? "" : editing.baseHash;
    const r = await runAction("files.save", { path: d.path, content: editing.text, baseHash }, { quiet: !overwrite });
    if (!r.ok) {
      conflict = /has changed/.test(r.error);
      return conflict ? showConflict() : undefined;
    }
    editing = null;
    conflict = false;
    await refresh();
  }

  function discard() {
    editing = null;
    conflict = false;
    show();
  }

  host.addEventListener("click", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const what = t.closest("[data-doc]")?.getAttribute("data-doc");
    if (what === "reload") return discard();
    if (what === "overwrite") return save(true);
    if (editing || t.closest("a")) return;
    const d = data();
    if (d?.content != null && d.hash) (editing = { text: d.content, baseHash: d.hash }), show();
  });

  show();
  return {
    update: show,
    /** whether Esc was used up by the editor */
    escape: () => (editing ? (discard(), true) : false),
    /** start editing (double-click on the board) */
    edit() {
      const d = data();
      if (!editing && d?.content != null && d.hash) (editing = { text: d.content, baseHash: d.hash }), show();
    },
    title: () => data()?.rel ?? "", // plain text: the panel sets it as textContent
  };
}
