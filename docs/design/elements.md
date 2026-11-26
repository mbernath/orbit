# Elements

## Session

### Glyph (12 px dot)

| State | Look |
|---|---|
| working | filled ink |
| waiting for the user | filled orange with a soft orange glow |
| done, not yet seen | hollow, 2 px orange ring |
| resting / idle / inactive | hollow, thin grey ring |
| "Snooze" (snoozed) | hollow, thin orange ring, no glow |
| fresh event (≤ 10 s) | one short ripple around the dot |

Ownership (ADR-0010) is a second, independent mark:

| Ownership | Mark |
|---|---|
| owned (runs in Orbit, SDK) | thin ring around the dot |
| observed (VS Code, terminal, Conductor) | bare dot |
| remote (cloud agent) | diamond instead of a dot |

Name beside the dot; PR number as a small chip after the name (orange when the PR needs the user). Selected (keyboard focus) = orange outline ring; open in panel = ink outline ring.

### Depth

| Depth | Shows |
|---|---|
| 0 | dot and name (if room) |
| 1 | + bubble with the last statement in two lines (not for resting sessions) |
| 2 | + the user's last prompt, the full last statement, the current step (working) |
| 3 | + last three tool steps, changed files, links, where it works and model ("Worktree …/Haupt-Checkout · Opus 5.5 · normal"), shared-checkout warning |
| r (reply) | last three messages (tool steps folded to "n steps"), prompt field |

**Action area** — always at the bottom of the bubble, after the last message, separated by a hairline: PR status line and its buttons; a pending permission request (Allow / Deny / Snooze); "Snooze" or "Seen" for a waiting or done session; "Run now" for agents.

### Detail panel

Title (editable), meta line `island · branch · location · model` (model is a button for owned sessions), agent role/trigger (editable), PR row, "Snooze", the conversation (tool steps folded, agent messages marked "from …"/"to …"), current step line, and at the bottom either the reply field or — for observed sessions, in the same place and width, where the user tries to type — "Runs outside Orbit — take it over to reply here. [Take over …]" (the in-place warning replaces it there; without a folder "Runs outside Orbit. Read-only here."). Archive icon and × in the header.

## Agent (ADR-0015, ADR-0016)

A session with a lasting identity: same glyph plus a small **moon** (top right). Shows role and trigger at depth 2, last runs at depth 3, "Run now" in the action area. Its runs are sessions that belong to it and do not get their own dots. Trigger is free text, read once into a rule and shown back ("Runs: after every merge into main"); not understood → manual only, and the agent says so.

## Document (Markdown file, ADR-0011)

Page glyph. Depth 1: name. Depth 2: first lines (faded). Depth 3: full rendered text, scrollable, "Last used by …". A change by a session shows as a bubble "New · by …" for 10 s; if there is no room for it, the name still shows (it is never hidden while fresh). Editing: click into the text in the panel, or double-click it on the board → Markdown source; ⌘S or leaving the field saves, Esc discards. Hovering a document highlights the sessions that used it (others fade).

## Memory

Stacked-cards glyph. Like a document; changes are announced the same way ("New · by transcript import").

## List (ADR-0036)

A node fed by a script on the island; the contract is agnostic (sections, items, tree, states, badges). List glyph. The script's order is kept everywhere; blocked items are marked, never moved.

| Depth | Shows |
|---|---|
| 0 | glyph and title, red mark if anything is blocked |
| 1 | + one line: the script's `summary`, else count per section ("Now 2 · Next 2 · Later 3") |
| 2 | + first open section with its first 3–5 items (state dot, title, `2/5` for items with children); other sections as one line "Next · 2"; "Stand: vor 4 Min." in the footer |
| 3 | + all sections (collapsed ones folded), children one level deep, badges, `stateLabel` |

**States:** `open` hollow dot · `active` filled ink · `blocked` filled red · `done` check, faded (hidden below depth 3).
**Panel:** whole tree, notes, filter by state and badge, link to the source, "Aktualisieren", failure details.
**Failure / stale:** last good list stays, timestamp dimmed with a warning mark; the script's `error` text in the panel.
**Changed since last look:** small dot beside the item (stable ids).

## Island

See [canvas.md](canvas.md). Menu behind `+` only adds (ADR-0042): New session … (N), New agent …, Pin file …, Pin list …. Its forms open as an anchored dialog at the "+" (primary button and Cancel).

**Island panel** (click on the island name): folders (home as ~); session defaults (model, thinking, mode); clean-up — Remove done from board · n, Remove inactive from board · n (each confirms in place, then undo), Tidy island, and one row "Removed from board · n ›" that opens its own view in the panel (‹ back, search, newest first with when, a click brings one back and the list stays; Esc goes back); Remove island … at the bottom (only when empty). Double-click on the name opens the panel with the name selected (rename by typing, Enter saves, Esc keeps the old one).

## Link

See [canvas.md](canvas.md#links). Behaviour open.

## CRUD matrix

| Element | Create | Read | Update | Delete / remove |
|---|---|---|---|---|
| Session | `+` → New session …, `N` | bubble by depth, detail panel | reply (bubble, panel, voice), rename (panel title, F2), move, take over (observed), model & effort, "Snooze", PR fix/merge | take off the board (panel icon, Entf) → undo (⌘Z, status line) → "Removed from board" in the island panel |
| Agent | `+` → New agent … (role + trigger) | as session + role, trigger, runs | rename, role, trigger, model, "Run now" | as session |
| Document | `+` → Datei anheften …, Neue Datei … | depth 2–3, panel | edit Markdown (panel, double-click on board) | unpin (panel icon) → undo / archive list |
| Memory | written by sessions | as document | edit as document | — |
| Island | double-click on empty canvas, first run | name, minimap, island panel | rename (double-click name), defaults (panel), move (drag name), resize (corner) | Remove island … in the panel (only when empty) → undo |
| Link | drag the ring, `V` | line, depth-3 bubble list | type, direction (click line) | Unlink (click line) |
| PR | on GitHub | chip, PR row, opens GitHub in a new tab; without a session on the board: one pill beside the island's "+" with the most urgent PR's number, its state as colour (red: CI failing, orange: ready to merge, outlined: review); more PRs, there or at a session, lie as an offset box behind the chip and a click lists them (number chip in its state's colour, then title; ADR-0038) | Merge …, Fix and merge, Fix only | — |

Location (worktree) and model are attributes of sessions and agents, see ADR-0017: default main checkout and no new branch; worktree on request before the first prompt or by asking the session; folders without git show "Ordner ohne Git" and no worktree or PR features.
