# ADR-0013 — A minimap and edge hints replace the "Braucht dich" sidebar

**Status:** Accepted · 2026-11-22

## Context

All workspaces share one canvas (ADR-0012). The user works on several projects in parallel and needs to notice what needs them anywhere on the canvas, and to know where he is. Today the board has a sidebar "Braucht dich" listing every entity with attention. A list next to the canvas duplicates what the canvas shows and takes width from it; the design direction is a calm canvas without legends or panels that explain it.

## Decision

- **Minimap** in a corner of the board: frames (islands) with their names, the current view as a rectangle, every element as a dot — entities with attention in the signal colour. Press and drag the view rectangle to move the camera; a press outside it centres the view there and the drag continues.
- **Edge hints:** every entity with attention that lies outside the visible area gets a small hint at the edge of the board, pointing towards it, with workspace, title and reason (waiting, done, CI red, mergeable). A click flies there. The entity whose conversation is open never gets one.
- **Placement rules** (part of the layout of ADR-0012): the element you are working with is placed first; edge hints then slide along their edge to a free spot, clear of that element, the minimap, other hints and all dots; everything else is placed around them. A hint with no free spot is dropped — the minimap still shows the entity.
- **The minimap gives way:** when the element you are working with needs its corner, the minimap shrinks to a small map instead of the board moving. Clicking it ends that interaction and unfolds the map.
- The **"Braucht dich" sidebar is removed.**

## Consequences

- Full width for the canvas; attention stays visible from anywhere through the hints and the minimap.
- Attention is now only discoverable spatially; there is no list to scan. If that proves too weak with many sessions, a keyboard jump through attention items (`W`) is the fallback, not a list.
- The layout checks of ADR-0012 extend to hints: they never cover a dot, a label or a bubble.

## Alternatives

- **Keep the sidebar.** Familiar and scannable, but duplicates the canvas and costs width permanently.
- **Sidebar and minimap together.** Two places for the same information.
- **Only the minimap, no edge hints.** Requires looking into a corner; hints put the signal where the eye already is.
