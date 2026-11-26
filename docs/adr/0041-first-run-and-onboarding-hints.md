# ADR-0041 — First run: folder suggestions, and hints that go away by doing

**Status:** Accepted · 2026-11-25 · amends [ADR-0031](0031-stale-hook-install-notice.md), relaxes a rule in `docs/design/copy.md`

## Context

Orbit is being shared with other developers. A fresh install showed an empty canvas with "No sessions yet. Start Claude Code in a project and it shows up here." — which was not true and left no way forward: without an island there is no "+" menu, sessions are only imported for island folders, and without the hook nothing new appears. The board also had a rule of no explanations on the canvas, so nothing taught the keys that make Orbit fast (Enter, S, W, Space, A/D, ?).

## Decision

**1. The empty board offers the user's own project folders.** The claude source reads the working directory of every project in `~/.claude/projects` (read only, as for the import) and serves the most recently used ones that are not yet an island, with their session count and last use. The empty board shows the top five as one-click suggestions plus "Choose another folder …". One click adds the island through the existing `workspaces.add` action; the import then fills it.

**2. A missing hook install gets a quiet line.** ADR-0031 stays: no hook at all is not a *stale* install. But once an island exists and no Orbit hook is installed, the board shows one quiet line with the install command, because live status is the point of Orbit. Same check endpoint, extended by `installed: boolean`.

**3. Hints appear once, at first need, and go away by doing.** A small set of hints, each tied to a moment (the first waiting session, the first open panel, …) and to the action that retires it (pressing S, pressing W, …). At most one hint shows at a time. There is no "Got it" button and no tour.

**4. Which hints are done lives in the browser (`localStorage`, key `orbit.hints`).** It is UI state of one person in one browser, not domain data. `?hints=reset` clears it.

## Consequences

- A new user gets from install to a board full of their own sessions in a few clicks.
- `copy.md`'s "no explanations on the board" gets one exception: these hints. Every new hint needs a moment and a retiring action, or it is not a hint but a legend.
- In another browser or profile the hints come back once. Acceptable for a local tool.
- The board needs a second browser-test server with an empty fixture (debt #10 becomes due for this case).

## Alternatives

- **Store hint progress in Orbit's database.** Survives a browser change, but needs a core setting and an action for something only the board reads.
- **A guided tour on first start.** Fast to build, but users click through tours without reading, and it teaches keys before they mean anything.
- **Suggest folders from the directory layout (`~/Src/*`).** No transcript reading, but guesses; the transcripts say where the user actually works.

## Amendment — 2026-11-25: choosing what comes along

A busy folder brought dozens of old sessions onto the first island at once, burying the few that matter now. A dialog asking "how many?" before the first click would stop the user at the very moment the board should just work.

- **The suggestions say how much comes along**, before the click: "42 sessions, 9 this week · 2 days ago". `FolderSuggestion` gains `recent` (transcripts changed in the last 7 days).
- **An island created from a suggestion on the first-run screen keeps only the recent sessions on the board:** those of the last 7 days, at most the 12 most recent. The older imported ones are archived through the existing `canvas.archive` action, in bulk, by the board right after `workspaces.add` — no core or import change. They stay restorable through the island menu ("Removed from board").
- **The board says what happened, once:** a quiet line at the island in the guide colour, "9 recent sessions · 33 older ones kept off the board — Keep · Show all · Show none". "Keep" (first, primary) just closes the line; the other two go through `canvas.archive` and offer Undo. The line goes after a choice or the first other board interaction; it is not stored. Nothing archived, no line. While it shows it is the one guide element on the board (no hint beside it); the moment it closes, in any way, the first hint follows at once, so the first run never stalls on it (2026-11-26, from onboarding feedback).

This relaxes [ADR-0005](0005-inactive-and-archive.md)'s "no automatic archiving" for exactly this one moment: the user's own click on a suggestion, with the result named and undoable. Islands added any other way, and the regular import, still archive nothing.
