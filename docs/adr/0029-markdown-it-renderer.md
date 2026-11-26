# ADR-0029 — The board renders Markdown with markdown-it, vendored as one ES module

**Status:** Accepted · 2026-11-23 · supersedes the rendering part of [ADR-0011](0011-markdown-files.md)

## Context

ADR-0011 chose a small built-in renderer for roadmaps and notes and named a library as the alternative "if more is needed". The board now also renders Claude's answers, which use full CommonMark. The built-in renderer flattened nested lists into one list styled by margin and started a new `<ol>` after every blank line, so a loose numbered list with sub-bullets showed as 1, 2, 3, 1, 2, 3. Each such case would need its own patch.

## Decision

- **markdown-it 14** renders all Markdown on the board. It implements CommonMark plus tables and strikethrough.
- **Vendored, no build step** (ADR-0002): one ES module `web/vendor/markdown-it.js`, bundled once with `bun build node_modules/markdown-it/index.mjs --format esm --minify --target browser` (its small dependencies included), with a minimal `markdown-it.d.ts` for the type check. Not a `package.json` dependency; updating means re-running that command and the tests.
- **Safety stays as before:** `html: false` escapes raw HTML; markdown-it's link validation rejects `javascript:`/`data:` URLs; on top, only `http(s)` links become anchors (`target="_blank" rel="noopener"`), other links render as their text. `linkify` and `typographer` are off.
- Task lists (`- [ ]`, `- [x]`) are a small core rule in `web/js/markdown.js`: disabled checkbox, item class `task`.
- `renderMarkdown(text)` stays the only entry point, so views do not change.

## Consequences

- Nested and loose lists, start numbers, code inside lists and the rest of CommonMark render correctly.
- About 108 KB more board code, loaded once from the local server.
- The bundle is third-party code in the repo; its licence header names version and source.

## Alternatives

- **Fix the built-in renderer.** Smallest, but every new construct in Claude's output is another patch.
- **marked.** Ships as ESM, smaller, but passes raw HTML through and would need DOMPurify or custom overrides to stay safe.

## Amendment 2026-11-24 — YAML frontmatter

A leading YAML block (`---` on the very first line, closed by `---` or `...`) is split off before rendering (`web/js/frontmatter.js`, pure). `renderMarkdown(text, { frontmatter })` decides what happens to it:

- `"hide"` (default) — left out. Bubbles, the conversation and plans show only the text.
- `"show"` — file views (document panel, file page, file preview) show it above the text as a key/value table (`dl.frontmatter`). Flat `key: value` pairs, `[a, b]` and `- item` lists are read; anything nested shows as raw text in `pre.frontmatter`. No YAML parser is vendored for this.

Only rendering changes: the editor and the saved file keep the frontmatter unchanged.
