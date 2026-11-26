// @ts-check
// Markdown file as a page glyph with its name; the bubble shows the first lines (depth 2) or the whole text (depth 3).
// Editing happens in the detail panel (panel.js), with the hash check of ADR-0011.
import { renderMarkdown } from "../markdown.js";
import { esc, folderOf } from "../util.js";
import { glyphSlot, registerView } from "./registry.js";

/** @param {import("./registry.js").Entity} e */
const d = (e) => /** @type {{ path: string, rel: string, content: string | null, hash: string | null, tracked: boolean | null }} */ (e.data);
/** file name without folder and extension */
const name = (/** @type {import("./registry.js").Entity} */ e) => (d(e).rel.split("/").pop() ?? d(e).rel).replace(/\.md$/i, "");

registerView({
  id: "page",
  kind: "file",
  size: () => ({ w: 280, h: 160 }),
  anchor: { x: 16, y: 80 },
  slot: glyphSlot,
  bubbleAt: (e, depth) => depth >= 2 && d(e).content != null,
  prio: () => 1,
  className: () => "glyphview g-page",
  render(e) {
    const content = d(e).content;
    return `
      <div class="ui" style="left:16px;top:80px">
        <span class="glyph page" data-dot></span>
        <div class="lab"><span class="lab-t">${esc(name(e))}</span></div>
        <div class="bub page-bub">
          <div class="b-peek doc-body scrollable">${content == null ? `<p class="b-meta">Too large for the board.</p>` : renderMarkdown(content, { copy: true, base: folderOf(d(e).path), frontmatter: "show" })}</div>
          <div class="b-meta">${esc(d(e).rel)}${d(e).tracked ? " · in repo" : d(e).tracked === false ? " · local" : ""}</div>
        </div>
      </div>`;
  },
});
