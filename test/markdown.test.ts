// Board Markdown renderer (web/js/markdown.js, ADR-0029): coverage of what roadmaps and Claude's answers use, and safety.
import { expect, test } from "bun:test";
import { renderMarkdown } from "../web/js/markdown.js";

// markdown-it puts newlines between block tags; they carry no meaning for these assertions.
const html = (md: string, base?: string) => renderMarkdown(md, { base }).replace(/>\n</g, "><");

test("Headings, paragraphs, emphasis, code", () => {
  expect(html("# Roadmap\n\nFirst line\nsecond **bold** and *italic* with `code`")).toBe(
    "<h1>Roadmap</h1><p>First line\nsecond <strong>bold</strong> and <em>italic</em> with <code>code</code></p>",
  );
  expect(html("```\nconst a = 1 < 2;\n```")).toBe("<pre><code>const a = 1 &lt; 2;\n</code></pre>");
  expect(html("~~gone~~")).toBe("<p><s>gone</s></p>");
});

test("Lists and task lists", () => {
  expect(html("- [x] Stage 1\n- [ ] Stage 2\n  - Sub-item")).toBe(
    '<ul><li class="task"><input type="checkbox" disabled checked /> Stage 1</li>' +
      '<li class="task"><input type="checkbox" disabled /> Stage 2\n<ul><li>Sub-item</li></ul></li></ul>',
  );
  expect(html("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  expect(html("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
});

test("A numbered list with blank lines and sub-items stays one list", () => {
  const out = html("1. **A**\n   - a1\n   - a2\n\n2. **B**\n   - b1\n\n3. **C**\n");
  expect(out.match(/<ol>/g)?.length).toBe(1);
  expect(out).toBe(
    "<ol><li><p><strong>A</strong></p><ul><li>a1</li><li>a2</li></ul></li>" +
      "<li><p><strong>B</strong></p><ul><li>b1</li></ul></li>" +
      "<li><p><strong>C</strong></p></li></ol>",
  );
});

test("Tables and quotes", () => {
  expect(html("| A | B |\n|---|---|\n| 1 | 2 |")).toBe(
    "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
  );
  expect(html("> Note")).toBe("<blockquote><p>Note</p></blockquote>");
});

test("Safety: HTML is escaped, only http(s) links become links", () => {
  expect(html('<img src=x onerror="alert(1)">')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  expect(html("[click](javascript:alert(1))")).not.toContain("<a");
  expect(html("[click](data:text/html,x)")).not.toContain("<a");
  expect(html("[Docs](https://example.com/a)")).toBe(
    '<p><a href="https://example.com/a" target="_blank" rel="noopener">Docs</a></p>',
  );
  expect(html("[ADR](docs/adr/0001.md)")).toBe("<p>ADR</p>");
  expect(html("<https://example.com>")).toContain('target="_blank" rel="noopener"');
});

test("Code blocks get a copy button on request, the code stays unchanged", () => {
  const src = "```ts\nconst a = 1 < 2;\n```\n\n    indented";
  expect(html(src)).not.toContain("data-copy");
  const button = '<button class="icon copy" data-copy="code" title="Copy code" aria-label="Copy code"></button>';
  expect(renderMarkdown(src, { copy: true }).replace(/>\n</g, "><")).toBe(
    `<div class="code">${button}<pre><code class="language-ts">const a = 1 &lt; 2;\n</code></pre></div>` +
      `<div class="code">${button}<pre><code>indented\n</code></pre></div>`,
  );
});

test("File references (ADR-0030): file://, absolute, relative to the base folder, with line; paths in inline code", () => {
  const a = (attrs: string, text: string) => `<a href="#" class="file-link" ${attrs} title="Preview · ⌘-click opens">${text}</a>`;
  expect(html("[demo.html](file:///Users/m/a%20b.html)")).toBe(`<p>${a('data-file="file:///Users/m/a%20b.html"', "demo.html")}</p>`);
  expect(html("[core.ts](src/core/core.ts#L127)", "/repo")).toBe(`<p>${a('data-file="src/core/core.ts" data-line="127" data-base="/repo"', "core.ts")}</p>`);
  expect(html("[core.ts](src/core/core.ts#L127)")).toBe("<p>core.ts</p>"); // relative without a base: text only
  expect(html("`web/js/panel.js:270` and `npm run x` and `a.b`", "/repo")).toBe(
    `<p>${a('data-file="web/js/panel.js" data-line="270" data-base="/repo"', "<code>web/js/panel.js:270</code>")} and <code>npm run x</code> and <code>a.b</code></p>`,
  );
  expect(html("[`src/a.ts`](src/a.ts:3)", "/repo")).toBe(`<p>${a('data-file="src/a.ts" data-line="3" data-base="/repo"', "<code>src/a.ts</code>")}</p>`);
  expect(html("`~/notes/x.md`")).toBe(`<p>${a('data-file="~/notes/x.md"', "<code>~/notes/x.md</code>")}</p>`);
  expect(html("[m](mailto:x@y)", "/repo")).toBe("<p>m</p>");
  expect(html('[x](/a"><img src=x>.ts)', "/repo")).not.toContain("<img");
});

test("Bare http(s) URLs become links (GFM autolinks), without trailing punctuation and parenthesis", () => {
  const url = "https://github.com/acme/widgets/issues/396";
  const a = `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
  expect(html(`I created the issue: **#396** (${url}). It is a task.`)).toBe(
    `<p>I created the issue: <strong>#396</strong> (${a}). It is a task.</p>`,
  );
  expect(html(`See ${url}, then continue`)).toBe(`<p>See ${a}, then continue</p>`);
  // balanced parentheses belong to the URL
  const wiki = "https://en.wikipedia.org/wiki/Orbit_(disambiguation)";
  expect(html(`(${wiki})`)).toBe(`<p>(<a href="${wiki}" target="_blank" rel="noopener">${wiki}</a>)</p>`);
  // existing links, inline code and code blocks stay as they are
  expect(html(`[Issue](${url})`)).toBe(`<p><a href="${url}" target="_blank" rel="noopener">Issue</a></p>`);
  expect(html(`\`${url}\``)).toBe(`<p><code>${url}</code></p>`);
  expect(html("ftp://example.com and javascript:alert(1)")).toBe("<p>ftp://example.com and javascript:alert(1)</p>");
});

test("Frontmatter: hidden by default, a key/value table on request", () => {
  const doc = "---\nname: commit-when-done\ndescription: \"Commit <each> change\"\ntags: [a, b]\nlist:\n  - x\n  - y\n---\n# Title\n";
  expect(html(doc)).toBe("<h1>Title</h1>");
  expect(renderMarkdown(doc, { frontmatter: "show" }).replace(/>\n</g, "><")).toBe(
    '<dl class="frontmatter"><div><dt>name</dt><dd>commit-when-done</dd></div>' +
      "<div><dt>description</dt><dd>Commit &lt;each&gt; change</dd></div>" +
      "<div><dt>tags</dt><dd>a, b</dd></div><div><dt>list</dt><dd>x, y</dd></div></dl><h1>Title</h1>",
  );
});

test("Frontmatter: nested YAML shows raw, only a fence on the first line counts", () => {
  const nested = "---\nmetadata:\n  type: user\n---\nText";
  expect(renderMarkdown(nested, { frontmatter: "show" })).toBe('<pre class="frontmatter">metadata:\n  type: user</pre>\n<p>Text</p>');
  expect(html("Text\n\n---\n\nmore: x\n\n---\n")).toBe("<p>Text</p><hr><p>more: x</p><hr>");
  expect(html("---\nno end")).toContain("no end");
  expect(html("---\r\na: 1\r\n---\r\nBody")).toBe("<p>Body</p>");
});
