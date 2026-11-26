# ADR-0042 — "+" only adds; the island gets a panel; one dialog component

**Status:** Accepted · 2026-11-26 · amends [ADR-0012](0012-frames-and-deterministic-layout.md) (island menu), [ADR-0025](0025-run-defaults-per-island.md) (where defaults are set)

## Context

The island menu behind "+" grew to twelve entries of three kinds: adding something to the island (session, agent, file, list), managing the island itself (session defaults, rename, remove, tidy, remove done/inactive, the "Removed from board" list) and "New island", which belongs to no island at all. Its forms replaced the menu's content: the submit button looked like a menu entry, there was no Cancel, and the session defaults were squeezed into a popover. The three real dialogs (pin file, merge, file preview) each wired their own HTML in `index.html`, closing, Esc and backdrop.

## Decision

**1. "+" only adds.** The menu holds New session … (N), New agent …, Pin file …, Pin list … — nothing else. The symbol promises exactly that.

**2. A click on the island name opens the island in the detail panel**, like a click on a session. The island panel holds what is about the island itself: its folders, session defaults (model, thinking, mode; ADR-0025), clean-up (Remove done from board · n, Remove inactive from board · n, Tidy island), one row "Removed from board · n ›" whose list is its own view in the panel (search, newest first; it can hold dozens after the first run), and Remove island … at the bottom (only when empty, in-place confirmation, then undo). A double-click on the name opens the panel with the name selected in its title field, ready to rename; dragging the name still moves the island.

The panel addresses an island by the board-only key `island:<workspace id>`. It is not an entity and nothing on the server changes: the panel reads workspaces from the store and writes through the existing actions (`workspaces.rename`, `workspaces.remove`, `owned.setDefaults`, `canvas.archive`).

**3. New island leaves the menu.** It stays a double-click on free space outside islands and the "Choose another folder …" of the first run; the shortcut overview names the double-click.

**4. One dialog component, `web/js/dialog.js`,** on the native `<dialog>` element: title, optional subline, body, a primary button and Cancel, error line, Esc and Cancel close, focus on the first field. Two placements: **anchored** at the control that opened it (the forms behind "+", so it stays clear which island they act on) and **centred modal** (pin file, merge, file preview). Field labels stay out (principle 4: placeholders); the component orders spacing, buttons and hierarchy.

## Consequences

- The "+" menu is four entries and never changes length; island management has room and is reachable by pointer and keyboard (Enter on a focused island name, later).
- The panel knows a second kind of key besides entity refs. It stays a board concern; if islands ever become entities, the key becomes a real ref.
- `index.html` loses its hand-written dialogs; every dialog gets the same closing, focus and button behaviour.
- Onboarding: the "tidy" hint now points at the island name ("Tidy island: click the name"), the "island" hint stays at the "+".

## Alternatives

- **One menu, grouped with separators.** Quick, but it stays a catch-all; New island and the defaults form still do not belong there.
- **A command palette (⌘K).** Scales and is searchable, but oversized for about a dozen actions and hard to discover. A possible later addition, not a replacement.
- **Islands as real entities from a source.** Would make the panel key a normal ref, but moves workspaces out of the core for a UI need.
