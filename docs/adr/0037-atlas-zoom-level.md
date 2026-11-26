# ADR-0037 — Atlas level: below the far zoom an island is a region on a map

**Status:** Accepted · 2026-11-24 · refines [ADR-0012](0012-frames-and-deterministic-layout.md), [ADR-0033](0033-glyphs-shrink-below-far-zoom.md), [ADR-0013](0013-minimap-and-edge-hints.md)

## Context

Below the far level glyphs shrink with the zoom (ADR-0033) and names hide below `g = 0.5`. What remains is frames full of nameless circles: every mark still costs ink but carries nothing. The minimap carried more information than the canvas at that zoom, yet looked cheap (cut names like "Tho…", grey crumbs, hard view rectangle).

At this distance the user asks one question: **"where am I needed?"**

## Decision

A fourth zoom level **atlas** with base depth −1, active when `g < 0.5`. It works like an atlas at continent scale: region names structure the space quietly, and only the important places are marked, at their real position (Tufte: every mark carries information, nothing twice, nothing cut off).

**Geometry does not change.** Frames and element positions stay where they are; only what is drawn changes. Crossing the threshold cross-fades (~0.25 s).

### What an island shows

1. **The island** keeps the ground and shape of the other levels: no border, no tint.
2. **Name** like a region name: one size for every island (12 px), spaced capitals, `--muted`. Top left as on the other levels. It never covers a place: a place under it moves it to the first free spot, row by row from the top left. Too long → two lines at the most balanced word break. Never shortened: no room → no name (hover shows it).
3. **Places**: every element that needs the user (same rule as elsewhere, "Später" does not count) as an orange glyph at its real position, in the look of the session glyph — filled when waiting, a ring when done. No label, no text.
4. **Dormant**: no activity in the island for 7 days, and nothing working or waiting → drawn faded.

Nothing else: no working elements, no resting ones, no counts, no texts.

### Interaction

- Hover an island whose name is hidden: the name in a bubble of the other levels. Otherwise no hover bubble.
- Click an island: zoom to the middle level and show that island (as `G` + letter).
- Click a place: go to that element (middle level, focus).

### Minimap

The same summary, drawn small: frames, and the places that need the user as orange dots at their real position; dormant fade; no names in the picture (name on hover). The view is a cut-out: outside it is slightly darkened. The minimap is hidden while the atlas level is active, and whenever the whole canvas fits into the view.

## Consequences

- Principles 1, 7 and "text never influences geometry" still hold: the atlas level depends on the camera only.
- ADR-0033's shrinking glyphs remain only between the far level and `g = 0.5`.
- The per-island summary (`web/js/atlas.js`) is computed from the store; no server change.

## Acceptance criteria

- ✓ At the atlas level no single element is drawn except the places that need the user.
- ✓ A place sits exactly where its glyph is on the other levels; a working or resting element has no place; no place carries text.
- ✓ Every island name has the same size, stays inside its frame, is never shortened and never covers a place.
- ✓ An island has the same ground as its frame and no border.
- ✓ A click on an island zooms to the middle level; no frame or element position changes. A click on a place goes to that element.
- ✓ An island without activity for 7 days is faded.
- ✓ The minimap is hidden at the atlas level and when the whole canvas fits into the view.

## Alternatives

- **Clamp the zoom at the far level.** Trivial, but large boards no longer fit into one view.
- **Keep names visible longer.** Small, but leaves the circle noise.
- **Glyph row with counts per kind.** Rejected: the number of sessions is not relevant at this distance.
- **Orange border and tinted ground, breathing ground while working** (first version). Rejected after trying it: a louder language than the other levels, not of one piece.
- **Status glyph before a centred name, sized to the island, plus a line `reason · title`** (second version). Rejected after trying it: name sizes without meaning, a redundant "fertig ·" in a line cut with "…", and the position of things lost.
- **Places with labels, working elements as ink dots** (proposed). Reduced to places only: at this distance only "where am I needed" counts.
