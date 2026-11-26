// @ts-check
// Atlas level (ADR-0037, docs/design/canvas.md "Atlas level"): below g = 0.5 an island is drawn like a region on a
// map — its name, and the places that need the user as orange dots at their real position. Nothing else.
// Pure: no DOM, unit-tested in test/atlas.test.ts. atlas-view.js draws it, minimap-canvas.js draws the same summary.

/** glyph scale below which the atlas level takes over (where names used to hide, ADR-0033) */
export const ATLAS_G = 0.5;
/** no activity for this long: the island is drawn faded */
export const DORMANT_MS = 7 * 24 * 3600_000;
/** one size for every island name, like region names in an atlas: size never pretends a rank */
export const NAME_PX = 12;
const PAD_X = 18, PAD_Y = 12, LINE = 1.3;
/** half a place glyph with its halo (style.css .a-place), the room a name keeps from it */
const PLACE_R = 9;

/** @param {number} g glyph scale (camera.js glyphScale) */
export const isAtlas = (g) => g < ATLAS_G;

/**
 * @typedef {{ ref: string, island: string, x: number, y: number, needs: boolean, ring: boolean, active: boolean,
 *   updatedAt: number }} AtlasItem x, y: world position of the glyph; ring: done rather than waiting; active: working or needing the user
 * @typedef {{ ref: string, x: number, y: number, ring: boolean }} Place
 * @typedef {{ places: Place[], dormant: boolean }} Summary
 */

/** @param {string[]} islands @param {AtlasItem[]} items @param {number} now @returns {Map<string, Summary>} */
export function summarise(islands, items, now) {
  /** @type {Map<string, Summary>} */
  const out = new Map();
  for (const id of islands) {
    const own = items.filter((it) => it.island === id);
    const last = Math.max(0, ...own.map((it) => it.updatedAt));
    out.set(id, {
      places: own.filter((it) => it.needs).map(({ ref, x, y, ring }) => ({ ref, x, y, ring })),
      dormant: !own.some((it) => it.active) && now - last > DORMANT_MS,
    });
  }
  return out;
}

/**
 * The island name at the one name size, top left: one line, else two lines at a word boundary, else null (only the
 * area; the name shows on hover). Never shortened — like a place name on a map, it shows whole or not at all.
 * @param {string} name @param {number} w frame width on screen @param {number} h frame height on screen
 * @param {(text: string) => number} measure width at NAME_PX
 * @returns {string[] | null} lines
 */
export function fitName(name, w, h, measure) {
  const room = w - 2 * PAD_X;
  const fits = (/** @type {string[]} */ lines) => PAD_Y + lines.length * NAME_PX * LINE <= h && lines.every((l) => measure(l) <= room);
  if (fits([name])) return [name];
  const words = name.split(/\s+/);
  // of the breaks that fit, the most balanced one (shortest longest line)
  let best = null, bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const widest = Math.max(...lines.map(measure));
    if (fits(lines) && widest < bestW) (best = lines), (bestW = widest);
  }
  return best;
}

/**
 * Where the name goes: top left as on the other levels; a place under it moves it to the first free spot, row by row from
 * the top left, like a map label on free ground. No free spot → null (the name shows on hover). A place is never covered.
 * @param {string[]} lines @param {number} w @param {number} h frame size on screen
 * @param {{ x: number, y: number }[]} places relative to the frame, on screen @param {(text: string) => number} measure
 * @returns {{ x: number, y: number } | null} top left of the name, relative to the frame
 */
export function nameSpot(lines, w, h, measure, places) {
  const nw = Math.max(...lines.map(measure)), nh = lines.length * NAME_PX * LINE, r = PLACE_R;
  // row by row from the top left, in steps of 6 px
  const spots = [];
  for (let y = PAD_Y; y <= h - PAD_Y - nh; y += 6) for (let x = PAD_X; x <= w - PAD_X - nw; x += 6) spots.push({ x, y });
  return spots.find((c) => c.y >= 0 &&
    !places.some((p) => p.x > c.x - r && p.x < c.x + nw + r && p.y > c.y - r && p.y < c.y + nh + r)) ?? null;
}
