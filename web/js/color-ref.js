// @ts-check
// Colour codes in rendered text (ADR-0045): which hex codes count as colours, and the same colour as rgb() and hsl().
// Pure. Only the long forms #rrggbb and #rrggbbaa: a short #123 is far more often an issue or PR number.

/** @typedef {{ hex: string, rgb: string, hsl: string }} ColorFormats */

// Not after a word character, "&" (entity), "/" or "#" (URL fragment, "##"); not followed by a word character or "-".
const HEX = /(?<![\w&/#])#(?:[0-9a-f]{8}|[0-9a-f]{6})(?![\w-])/gi;

/** Where colour codes sit in a text. @param {string} text @returns {{ at: number, hex: string }[]} */
export function findColors(text) {
  return [...text.matchAll(HEX)].map((m) => ({ at: m.index ?? 0, hex: m[0] }));
}

const round = (/** @type {number} */ n, /** @type {number} */ d = 0) => Number(n.toFixed(d));

/** The colour as hex (as written), rgb() and hsl(); the alpha channel only when not opaque. @param {string} hex @returns {ColorFormats} */
export function colorFormats(hex) {
  const v = hex.slice(1);
  const [r, g, b, a = 255] = [0, 2, 4, 6].map((i) => (i < v.length ? parseInt(v.slice(i, i + 2), 16) : 255));
  const alpha = a === 255 ? "" : `, ${round(a / 255, 2)}`;
  const R = (r ?? 0) / 255, G = (g ?? 0) / 255, B = (b ?? 0) / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return {
    hex,
    rgb: `${alpha ? "rgba" : "rgb"}(${r}, ${g}, ${b}${alpha})`,
    hsl: `${alpha ? "hsla" : "hsl"}(${round(h * 60) % 360}, ${round(s * 100)}%, ${round(l * 100)}%${alpha})`,
  };
}
