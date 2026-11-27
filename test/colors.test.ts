// Colour codes in rendered text (ADR-0045): recognition, formats, and the swatch in rendered Markdown.
import { expect, test } from "bun:test";
import { colorFormats, findColors } from "../web/js/color-ref.js";
import { renderMarkdown } from "../web/js/markdown.js";

const hexes = (s: string) => findColors(s).map((c) => c.hex);

test("Long hex codes are colours; short ones, issue numbers and fragments are not", () => {
  expect(hexes("Use #3B82F6 and #3b82f680, not #fff or #fade.")).toEqual(["#3B82F6", "#3b82f680"]);
  expect(hexes("Fixed in #123456789 and PR #1234")).toEqual([]);
  expect(hexes("see https://x.dev/page#abcdef and a##abcdef and &#abcdef")).toEqual([]);
  expect(hexes("#abcdeg #abcdef- x#abcdef")).toEqual([]);
  expect(hexes("(#00ff00), `#112233`")).toEqual(["#00ff00", "#112233"]);
});

test("Formats: rgb and hsl, alpha only when not opaque", () => {
  expect(colorFormats("#3b82f6")).toEqual({ hex: "#3b82f6", rgb: "rgb(59, 130, 246)", hsl: "hsl(217, 91%, 60%)" });
  expect(colorFormats("#ffffff")).toEqual({ hex: "#ffffff", rgb: "rgb(255, 255, 255)", hsl: "hsl(0, 0%, 100%)" });
  expect(colorFormats("#ff000080")).toEqual({ hex: "#ff000080", rgb: "rgba(255, 0, 0, 0.5)", hsl: "hsla(0, 100%, 50%, 0.5)" });
});

const sw = (hex: string) => `<button type="button" class="swatch" data-color="${hex}"`;

test("Rendered Markdown puts a swatch before the code in text and inline code, the text stays", () => {
  const out = renderMarkdown("Accent **#534ab7** and `color: #ff000080;`");
  expect(out).toContain(`<strong>${sw("#534ab7")}`);
  expect(out).toContain('aria-label="Colour #534ab7"></button>#534ab7</strong>');
  expect(out).toContain(`<code>color: ${sw("#ff000080")}`);
  expect(out).toContain("></button>#ff000080;</code>");
});

test("No swatch inside links, code blocks or for short forms", () => {
  expect(renderMarkdown("[#534ab7](https://x.dev) [`#534ab7`](https://x.dev)")).not.toContain("swatch");
  expect(renderMarkdown("```css\na { color: #534ab7 }\n```")).not.toContain("swatch");
  expect(renderMarkdown("`#fff` and #abc")).not.toContain("swatch");
});
