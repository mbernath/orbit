// @ts-check
// Markdown renderer for the board (ADR-0029): markdown-it, CommonMark plus tables and strikethrough.
// Raw HTML is escaped (html: false); http(s) links open in a new tab, local file references open the file
// (ADR-0030, file-links.js), other links render as their text.
import MarkdownIt from "../vendor/markdown-it.js";
import { codeTarget, linkTarget } from "./file-ref.js";
import { splitFrontmatter } from "./frontmatter.js";
import { esc } from "./util.js";
/** @typedef {import("./file-ref.js").FileRef} FileRef */
/** @typedef {{ copy?: boolean, base?: string | null }} Env */
/** @typedef {import("../vendor/markdown-it.js").RenderRule} RenderRule */

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
const isHttp = (/** @type {string | null} */ href) => /^https?:\/\//i.test(href ?? "");

// Task lists: "- [ ] text" / "- [x] text" become a disabled checkbox; the item gets class "task".
md.core.ruler.push("task_lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    const item = tokens[i - 2];
    if (inline?.type !== "inline" || tokens[i - 1]?.type !== "paragraph_open" || item?.type !== "list_item_open") continue;
    const m = inline.content.match(/^\[( |x|X)\]\s+/);
    const first = inline.children?.[0];
    if (!m || first?.type !== "text") continue;
    first.content = first.content.slice(m[0].length);
    inline.content = inline.content.slice(m[0].length);
    item.attrSet("class", "task");
    item.meta = { ...item.meta, checked: m[1] !== " " };
  }
});

// file: targets must reach the link rules (ADR-0030); script and data URLs stay rejected.
md.validateLink = (/** @type {string} */ url) => !/^\s*(javascript|vbscript|data):/i.test(url);

// Bare http(s) URLs become links, as in GitHub Flavored Markdown: Claude writes them that way because the terminal
// links them. Trailing punctuation and an unbalanced closing parenthesis stay outside the link.
const BARE_URL = /https?:\/\/[^\s<>]+/gi;
/** @param {string} url */
const trimUrl = (url) => {
  let u = url.replace(/[.,;:!?'"*_]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
    u = u.slice(0, -1).replace(/[.,;:!?'"*_]+$/, "");
  }
  return u;
};
md.core.ruler.push("bare_urls", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out = [];
    let depth = 0;
    for (const t of block.children) {
      if (t.type === "link_open") depth++;
      if (t.type === "link_close") depth--;
      if (t.type !== "text" || depth > 0 || !/https?:\/\//i.test(t.content)) {
        out.push(t);
        continue;
      }
      let last = 0;
      for (const m of t.content.matchAll(BARE_URL)) {
        const url = trimUrl(m[0]);
        const at = m.index ?? 0;
        if (at > last) out.push(Object.assign(new state.Token("text", "", 0), { content: t.content.slice(last, at) }));
        const open = new state.Token("link_open", "a", 1);
        open.attrSet("href", url);
        out.push(open, Object.assign(new state.Token("text", "", 0), { content: url }), new state.Token("link_close", "a", -1));
        last = at + url.length;
      }
      if (last < t.content.length) out.push(Object.assign(new state.Token("text", "", 0), { content: t.content.slice(last) }));
    }
    block.children = out;
  }
});

// http(s) links stay anchors, local file references become file links (ADR-0030), anything else keeps only its text.
md.core.ruler.push("link_kinds", (state) => {
  const base = /** @type {Env} */ (state.env).base;
  for (const block of state.tokens) {
    /** @type {object[]} */
    const open = [];
    for (const t of block.children ?? []) {
      if (t.type === "link_open") {
        const href = t.attrGet("href") ?? "";
        const file = isHttp(href) ? null : linkTarget(href, base);
        const kind = isHttp(href) ? { web: true } : file ? { file } : { drop: true };
        open.push(kind);
        t.meta = { ...t.meta, ...kind };
      } else if (t.type === "link_close") {
        t.meta = { ...t.meta, ...(open.pop() ?? {}) };
      }
    }
  }
});

/** @param {FileRef} f @param {string | null | undefined} base */
const fileAnchor = (f, base) =>
  `<a href="#" class="file-link" data-file="${esc(f.path)}"${f.line ? ` data-line="${f.line}"` : ""}${base ? ` data-base="${esc(base)}"` : ""} title="Preview · ⌘-click opens">`;

/** @type {RenderRule} */
const linkOpen = (tokens, idx, options, env, self) => {
  const t = /** @type {import("../vendor/markdown-it.js").Token} */ (tokens[idx]);
  if (t.meta?.drop) return "";
  if (t.meta?.file) return fileAnchor(t.meta.file, /** @type {Env} */ (env).base);
  t.attrSet("target", "_blank");
  t.attrSet("rel", "noopener");
  return self.renderToken(tokens, idx, options);
};
/** Inline code that names a file opens it, too. @type {RenderRule} */
const codeInline = (tokens, idx, _options, env) => {
  const content = tokens[idx]?.content ?? "";
  const code = `<code>${esc(content)}</code>`;
  const before = tokens.slice(0, idx).map((t) => t.type);
  const inLink = before.lastIndexOf("link_open") > before.lastIndexOf("link_close"); // already inside an anchor
  const file = inLink ? null : codeTarget(content, /** @type {Env} */ (env).base);
  return file ? `${fileAnchor(file, /** @type {Env} */ (env).base)}${code}</a>` : code;
};
/** @type {RenderRule} */
const linkClose = (tokens, idx, options, _env, self) =>
  tokens[idx]?.meta?.drop ? "" : self.renderToken(tokens, idx, options);
/** @type {RenderRule} */
const listItemOpen = (tokens, idx, options, _env, self) => {
  const t = tokens[idx];
  const html = self.renderToken(tokens, idx, options);
  if (t?.meta?.checked === undefined) return html;
  return `${html}<input type="checkbox" disabled${t.meta.checked ? " checked" : ""} /> `;
};
/** Code blocks get a copy button (handled by copy.js) when the caller asks for it. @param {RenderRule | undefined} base @returns {RenderRule} */
const withCopy = (base) => (tokens, idx, options, env, self) => {
  const html = base ? base(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  if (!(/** @type {Env} */ (env).copy)) return html;
  return `<div class="code">${COPY_CODE}${html}</div>\n`;
};
const COPY_CODE = `<button class="icon copy" data-copy="code" title="Copy code" aria-label="Copy code"></button>`;

const rules = md.renderer.rules;
Object.assign(rules, {
  link_open: linkOpen,
  link_close: linkClose,
  list_item_open: listItemOpen,
  code_inline: codeInline,
  fence: withCopy(rules.fence),
  code_block: withCopy(rules.code_block),
});

/** @param {import("./frontmatter.js").Frontmatter} f */
const frontmatterHtml = (f) => {
  if (!f.raw?.trim()) return "";
  if (!f.fields) return `<pre class="frontmatter">${esc(f.raw)}</pre>\n`;
  const rows = f.fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  return `<dl class="frontmatter">${rows}</dl>\n`;
};

/**
 * @param {string} text
 * @param {Env & { frontmatter?: "show" | "hide" }} [opts] copy: a copy button on every code block; base: folder that
 *   relative file references start from; frontmatter: a leading YAML block as a key/value table ("show", for file
 *   views) or left out ("hide", the default, for bubbles and chat)
 * @returns {string} HTML
 */
export function renderMarkdown(text, opts = {}) {
  const f = splitFrontmatter(text);
  const head = opts.frontmatter === "show" ? frontmatterHtml(f) : "";
  return (head + md.render(f.body, { copy: !!opts.copy, base: opts.base ?? null })).trimEnd();
}
