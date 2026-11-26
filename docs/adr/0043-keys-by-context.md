# ADR-0043 — Keys by where they work; one table; Snooze is ⌘⇧S

**Status:** Accepted · 2026-11-26 · amends the key table in `docs/design/interaction.md`

## Context

The board has two kinds of keys without saying so. Single letters (S, Space, A/D, W/Q, N, F2, Delete) act only when the board has the focus and nothing is typed; ⌘⇧ combinations (⌘⇧F, ⌘⇧⌫, ⌘⇧Enter) and Esc act also in the panel and while typing. The panel's "Seen (S)" tooltip promised a key that never works there, because the focus sits in the panel. Which key the board names was written by hand in four places (the overview, tooltips, hints, the menu), so nothing kept them in step; ⌘⇧F and ⌘⇧Enter were missing from the overview.

## Decision

1. **A key is named only where it works.** Board keys show on the board (bubble, "+" menu, hints), never in the panel. In native tooltips the key follows in parentheses.
2. **One table, `web/js/key-table.js`:** key, what it does, and where it works (`board`, `anywhere`, `field`, `pointer`). The overview `?` is built from it in those four groups; tooltips go through `tip(label, id, place)`, which adds the key only when it works at that place. A unit test checks that every `tip()` names a key of the table and that no tooltip writes a key by hand. The handlers (`keys.js`, `panel-size.js`, `panel-owned.js`) stay where they are.
3. **Snooze / Seen is ⌘⇧S**, like ⌘⇧F: on the open element in the panel, also while typing, else on the focused or hovered element. S alone does nothing any more.
4. **Not every panel button gets a key.** Frequent ones work everywhere (⌘⇧S, ⌘⇧F, ⌘⇧⌫, ⌘⇧Enter, Esc). Rare or irreversible ones (Merge …, Fix and merge, Take over …, Remove island …) get none: a slip would do the wrong thing, and Tab plus Enter reach them.

## Consequences

- The panel offers Snooze by key for the first time; the board's S habit changes to ⌘⇧S.
- ⌘⇧S is "Save as" in some browsers; Orbit prevents the default while it acts. Browser-reserved keys cannot be taken, so new ⌘⇧ keys are checked against Chrome, Safari and Firefox first (⌘⇧A, for one, is Chrome's tab search — Allow / Deny stay A / D on the board for now).
- A new key is one row in the table plus its handler; the overview follows by itself.

## Alternatives

- **Esc in the reply field gives the focus to the board**, so every letter works on the open element. No new combinations, but it changes what Esc does in the panel, and letters would sometimes type and sometimes act.
- **A custom tooltip component** to show keys as boxes in tooltips too. Possible, but a module of its own (delay, placement, accessibility) for a look the native tooltip nearly has.
