# ADR-0033 — Glyphs shrink below the far zoom; the first start never zooms out further

**Status:** Accepted · 2026-11-23 · refines [ADR-0012](0012-frames-and-deterministic-layout.md) · below `g = 0.5` superseded by [ADR-0037](0037-atlas-zoom-level.md) (atlas level)

## Context

Text and glyphs keep their screen size at every zoom (ADR-0012), only distances scale. Below the far level (`LEVEL_K.far`) this breaks down: dots 60 world px apart lie 18 screen px apart at k 0.3, while a dot is 20 px; they overlap each other and the island name, and almost every name is hidden for lack of room. The very first start fitted all islands into the window and could land at k 0.15, so this was the first thing the user saw.

## Decision

- **Glyph scale** `g = min(1, k / LEVEL_K.far)` (`glyphScale` in `web/js/camera.js`). At and above the far level `g = 1`: nothing changes. Below it dots, names and island heads shrink with the zoom, so they keep the proportions they had at the far level and stop colliding.
- The board applies it through the existing `--inv` (`g / k` instead of `1 / k`); placement gets `g` and scales dot boxes, name sizes and the offsets of names and bubbles with it.
- **Exception:** a bubble keeps its full size (it is counter-scaled by `1 / g`), so the element the user hovers or replies to stays readable at any zoom. Only its distance from the dot shrinks.
- Names are hidden below `g = 0.5` (text under ~6.5 px helps nobody), except for the element the user works with.
- **First start:** the start fit never zooms out beyond the far level. If everything does not fit at that zoom, it shows the top left of the board; minimap and edge hints lead to the rest.

## Consequences

- "Text never influences geometry" still holds: `g` depends on the camera only.
- At very small zoom a dot is a few pixels; its hit area shrinks with it. Acceptable for now; if it bothers, a minimum hit area via a transparent outline.
- The minimap is not touched by this; it has its own overlap of names and dots (separate step).

## Alternatives

- **Stack overlapping dots** into one glyph with a count. Solves overlap at any zoom but is a new concept with its own interaction; kept for later if shrinking is not enough.
- **Keep constant size and clamp the zoom** at the far level. Simple, but takes away the overview of many islands.
