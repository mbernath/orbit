# ADR-0022 — Board DOM: one owner per piece of state, write only on change, measure off-screen

**Status:** Accepted · 2026-11-23 · refines [ADR-0012](0012-frames-and-deterministic-layout.md)

## Context

Elements flickered after every change, most visibly when one element was dropped: all others faded in again. A mutation log showed why. On each render, `render.js` rewrote every element's `className`, removing the placement classes (`sl`, `sb`) that `board-layout.js` had set. The layout pass then measured each element by switching its `data-depth` on the live node and reading `offsetWidth`, which forced the browser to compute the in-between state. Re-adding the classes started the CSS fade-in from there. Edge hints were rebuilt from scratch on every pass, too.

## Decision

- **One owner per piece of state.** The renderer owns content (`innerHTML`, via a hash), position, size and the view's own classes, tracked in `data-own`; it never touches placement state. `board-layout.js` owns `data-depth`, `data-side`, `data-corner`, the bubble's slide and the classes `sl`, `sb`, `prio`, `fresh`.
- **Write only on change.** Every write to the board DOM compares first. A pass that decides what the last one decided produces no DOM mutation at all, so no transition restarts.
- **Measure off-screen.** Sizes of names and bubbles come from an invisible copy outside the board (`measure.js`), cached by element, content, view classes and depth. Measuring never changes what the user sees.
- **Keep, don't rebuild.** Edge hints and other overlays are kept by id across passes and updated in place.
- A browser test asserts that dropping one element causes no mutation on any other.

## Consequences

- Flicker from re-rendering is gone by construction, not by timing.
- New views follow the same rule: render content, never placement state; anything layout-related is set by the layout pass.
- Measuring is cached, so a layout pass costs little when nothing changed (resolves debt #11).

## Alternatives

- **Disable CSS transitions.** Hides the symptom and loses the calm fade the design asks for.
- **A virtual DOM library.** Solves diffing generally, but a dependency and a build step against ADR-0002.
