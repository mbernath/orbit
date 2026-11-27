// @ts-check
// Colour swatches in rendered Markdown (ADR-0045): a markdown-it plugin that puts a swatch before every colour code
// in text and inline code, outside links. The swatch is a button; color-pop.js opens it.
import { colorFormats, findColors } from "./color-ref.js";

/** @param {string} hex @returns {string} HTML; hex is checked by findColors, so it is safe in attributes and CSS */
export function swatch(hex) {
  const f = colorFormats(hex);
  return `<button type="button" class="swatch" data-color="${hex}" style="--c:${hex}" title="${f.hex} · ${f.rgb} · ${f.hsl}" aria-label="Colour ${hex}"></button>`;
}

/** Inline code with its colour codes swatched. @param {string} code already escaped @returns {string} */
export function swatchCode(code) {
  let out = "";
  let last = 0;
  for (const c of findColors(code)) {
    out += code.slice(last, c.at) + swatch(c.hex);
    last = c.at;
  }
  return out + code.slice(last);
}

/** @param {import("../vendor/markdown-it.js").default} md */
export function colorSwatches(md) {
  md.core.ruler.push("color_swatches", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const out = [];
      let depth = 0;
      for (const t of block.children) {
        if (t.type === "link_open") depth++;
        if (t.type === "link_close") depth--;
        const found = t.type === "text" && depth === 0 ? findColors(t.content) : [];
        if (!found.length) {
          out.push(t);
          continue;
        }
        let last = 0;
        for (const c of found) {
          if (c.at > last) out.push(Object.assign(new state.Token("text", "", 0), { content: t.content.slice(last, c.at) }));
          out.push(Object.assign(new state.Token("color_swatch", "", 0), { content: c.hex }));
          last = c.at;
        }
        out.push(Object.assign(new state.Token("text", "", 0), { content: t.content.slice(last) }));
      }
      block.children = out;
    }
  });
  md.renderer.rules.color_swatch = (tokens, idx) => swatch(tokens[idx]?.content ?? "");
}
