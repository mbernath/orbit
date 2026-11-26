# ADR-0034 — Several elements: selection, group move, grid, align and distribute

**Status:** Accepted · 2026-11-23 · refines [ADR-0012](0012-frames-and-deterministic-layout.md)

## Context

The user arranges the dots on their islands by hand. Moving them one by one, and lining them up by eye, is slow. He decided (2026-11-23): selection by ⇧-drag, elements never move into another island, and any automatic arrangement only as a one-off action, never a live sort.

## Decision

- **Selection** is board state only (`web/js/selection.js`), never stored. ⇧ + drag on free space draws a rectangle; it selects every element whose dot lies inside (⇧ adds to the selection). ⇧ + click on a dot toggles it. Esc, or a plain click on free space, clears it. Selected dots get a ring; the class `selected` is owned by the selection module (ADR-0022).
- **Group move:** dragging a selected element moves the whole selection by the same delta. Each island is treated on its own: the box around its selected elements goes through the same `dropInFrame` rule as a single element (inside stays, beyond the edge the frame grows once, otherwise it is kept inside). Elements never change island.
- **Grid:** every drop snaps the dragged dot to a 16 world px grid; ⌥ while dragging turns it off. Existing positions are not touched until they are moved.
- **Align and distribute** (≥ 2 selected): a bar at the top of the board and keys. The reference is the dot, never the name — text does not influence geometry. Each island is aligned on its own, so nothing leaves its frame. Distribute spaces the dots evenly between the two outermost ones.
- **Undo:** a group move, alignment or distribution is one undo step in the existing status line ("… · Rückgängig", ⌘Z).
- **No contract change:** all moves of one step go in one `canvas.frame` call (frames plus `moves`, already atomic).
- The geometry is pure (`web/js/arrange.js`) and unit-tested.

## Consequences

- Arrow keys with a selection nudge it by one grid step (⇧: 10 steps) instead of panning.
- Automatic arrangements (by state, compact …) can build on `arrange.js` and the same undo step later.

## Alternatives

- **Lasso as its own tool mode:** one more mode to switch; ⇧-drag was free.
- **Snap lines to other dots:** more visual noise; the grid gives most of the benefit. Can come later.
