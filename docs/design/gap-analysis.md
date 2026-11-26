# Gap analysis: board today vs. design specification

**As of 2026-11-22.** Compares the working tree (server `src/`, board `web/`) with the ADRs and this design specification, and orders the work. Remove sections as they are done.

## What already fits and stays

- **Server architecture** (ADR-0007/0008/0009): core + sources, entities with refs, elements with `x, y, w, h, parent, archived`, one action layer with risk levels, SSE. The redesign builds on it; no rewrite.
- **Actions that already exist** and map onto the new UI: `canvas.place`, `canvas.archive` (remove from board / bring back), `claude.rename` (title), `claude.ack` ("Seen"/"Snooze" — see below), `files.pin` / `files.unpin` / `files.save` (with hash check), `github.merge`, `github.refresh`, `workspaces.add` / `workspaces.remove`.
- **Board patterns worth keeping:** the view registry (ADR-0008), central handling of `data-action` / `data-edit`, keyed rendering that keeps DOM state during edits, `@ts-check` against `src/core/types.ts`, the Markdown renderer, the file picker.

## What is replaced

| Today | Target | Why |
|---|---|---|
| Lanes per workspace with masonry auto-layout (`layout.js`, `renderLaneLabels`) | Frames as elements (kind `frame`, `w`/`h` stored), placement inside frames, growth on drop | ADR-0012; resolves debt #3 and #5 |
| Session cards 280 × 124 px with fixed text | Dot + name + bubble with depth levels, constant screen-size text | design/canvas.md, design/elements.md |
| Sidebar "Needs you" + workspace filter | Minimap + edge hints; no filter (one canvas) | ADR-0013 |
| Toolbar: zoom label, "Archive inactive", "Show archive" | Zoom dots, `?`; archive list per island; bulk archive of inactive sessions as an island-menu entry | design/interaction.md |
| Zoom range 0.15–2 with scaling text | Three zoom levels over a continuous range; text at constant size | ADR-0012 |
| Merge dialog (modal) | Confirmation in place in the PR row | design/interaction.md |
| "Focus" from the sidebar centres the camera | Navigation pans minimally, keeps zoom | ADR-0012 camera |

## What is missing

**Board, no new server capability needed**
1. A pure, DOM-free layout module (depth, names, bubbles, edge hints, priorities, stickiness) with unit tests for every ✓ in design/canvas.md.
2. Camera controller implementing the camera rules; keyboard map as a data table.
3. Detail panel (conversation, meta line, actions) — needs the transcript tail from the server (debt #2 fires).
4. Island menu, archive list, island rename (needs `workspaces.rename`), "Neue Insel" (exists as `workspaces.add`).
5. Document editing in the new form (action exists).

**Server, small**
6. `workspaces.rename`; frame elements per workspace (create on first use, keep geometry).
7. "Snooze" semantics: **verified, no change needed.** `claude.ack` sets `acknowledged = 1`; every new `waiting` or `done` hook event writes `acknowledged = 0` again (`src/sources/claude/index.ts`), so a silenced session calls again exactly when it says something new.
8. Transcript tail endpoint for the panel and depth-2/3 bubbles (last prompt, last messages, tool steps).

**Server, large — new capability**
9. **Owned sessions** (ADR-0010): create a session in an island, reply, answer permission requests, take over an observed session, model and effort, worktree on request. Runs through `claude -p` with the user's login, no SDK ([ADR-0019](../adr/0019-owned-sessions-via-claude-cli.md)).
10. PR "Fix and merge" (ADR-0014) — a prompt to the owning session; depends on 9.
11. Agents and triggers (ADR-0015/0016): agent entity, runs as child sessions, rule engine on core events, one LLM call to read a trigger; depends on 9.
12. Memory files on the board (needs the MCP ADR that is still missing).

**Open by decision:** links (drawn only, no behaviour), voice input.

## Complexity to remove on the way

- `render.js` computes layout and renders in one pass and owns lane labels; split into layout (pure), placement (pure), DOM (thin).
- `main.js` mixes wiring, toolbar, empty state, notifications, filters and the event switch; move the event switch into the interaction controller, drop toolbar and filter code with the sidebar.
- Full-state reload on every SSE signal (debt #1) is fine for now; revisit when the panel streams a live transcript.
- Browser notifications (`notify()`): keep or drop is still open — they duplicate the edge hints but work when the tab is hidden.

## Status

- **Slice 1 done (2026-11-22, not committed):** `canvas.frame` (one or several frames plus element moves, atomic, overlap rejected); pure `web/js/frames.js` and `web/js/camera.js` with unit tests; lanes, masonry, sidebar, workspace filter, toolbar and browser notifications removed; island menu behind `+` (Pin file, Remove inactive from board, Removed from board, Rearrange, New island); Playwright set up with 6 browser tests (`bun run test:e2e`). Cards are still cards — slice 2 turns them into dots, names and bubbles.

- **Slice 2 done (2026-11-22, not committed):** sessions are dots with name and bubble (`views/session-dot.js`); pure `web/js/placement.js` (depth by zoom and attention, names like on a map, bubbles inside their island, locked corner while hovered, edge hints) with unit tests; DOM adapter `web/js/board-layout.js`; minimap with drag; zoom dots (far/middle/near); "Snooze"/"Seen" through `claude.ack` with a thin orange ring; fresh-event ripple; keys: arrows pan, + / −, W / Q, Esc. 12 browser tests. Documents and repo panels are still cards (slice 3).

## Order of work (vertical slices)

Each slice ends with green `bun test`, green Playwright tests for its criteria, and a screenshot.

| # | Slice | Depends on |
|---|---|---|
| 1 | **Foundation:** Playwright setup; pure layout and camera modules with tests; frames from workspaces (server 6); remove lanes, masonry, sidebar, filter, toolbar | — |
| 2 | **Board reading:** dots, names, depth and bubbles from existing data; attention, "Snooze"/"Seen" (existing `claude.ack`); minimap, edge hints; documents at depth 2–3 | 1 |
| 3 | **Detail panel and management:** transcript tail (server 8), panel, rename, take off board + archive list + undo, island menu, island rename/new/remove, document editing, PR row with in-place merge | 2 |
| 4 | **Owned sessions (`claude -p`, ADR-0019):** new session (`+`/N), reply in bubble and panel, permission answers, take over, model/effort, worktree on request | 3 |
| 5 | **Agents and triggers;** PR fix-and-merge | 4 |

Slices 1–3 make the new board fully usable for observing and managing, without any new dependency besides Playwright. Slice 4 is where Orbit starts to act.
- **Slice 3 done (2026-11-22, not committed):** detail panel (`web/js/panel.js`): editable title, meta line, PR row with in-place merge confirmation, Snooze/Seen, conversation from `GET /api/conversation` with tool steps folded, note for observed sessions; closes with ×, Esc or a plain canvas click, the camera stays. Documents are page glyphs (`views/file-page.js`) with peek bubble; edited in the panel (`panel-doc.js`) with hash check and conflict choice (a conflict now refreshes the file snapshot on the server). `board-layout.js` places every view that declares an `anchor`. Taking off the board (panel icon, Entf) with status line and ⌘Z (`undo.js`, `remove.js`); island menu as its own module with archive list, rename, remove-only-when-empty with undo. Keys: Enter, F2, Entf, S, ⌘Z, ?, Esc closes the innermost thing. 20 browser tests. Open from slice 3: none; reply field and take-over follow in slice 4.
- **Slice 4 done (2026-11-22, not committed):** owned sessions through `claude -p` (ADR-0019): streaming runner in the core, source `owned/` (start, send with queue, permission answers, takeover with confirmation, model and effort, restart → "interrupted"), linked to the session by `claude:<id>`. Board: ring for owned sessions; a question turns the dot orange with Allow/Deny in bubble and panel; reply field, model and thinking effort in the panel; "Take over …" with an in-place warning for observed sessions; "New session …" in the island menu and on N; keys Space, A/D (then E/A). Browser tests run against a fake CLI (`test/e2e/fake-claude.ts`). 24 browser tests. Open: reply in the bubble (debt #18).
- **Worktree on request done (2026-11-22, not committed):** the hook also reports the top of the checkout (`X-Orbit-Git-Top`, same git call); sessions show "eigener Worktree · <branch>", "Haupt-Checkout · <branch>" or "Ordner ohne Git" in the panel meta and the near bubble, and a quiet warning when active sessions share a main checkout. "Neue Session" offers "eigener Worktree statt Haupt-Checkout" → `.worktrees/<slug>` on `feat/<slug>` from the first words; taking such a session off the board offers "Worktree auch entfernen" (never `--force`). 26 browser tests. Slice 4 is complete except the bubble reply (debt #18).
- **Slice 5 done (2026-11-22, not committed):** 5a PR fix-and-merge (ADR-0014). 5b agents (ADR-0020): core contracts `ctx.act` and `ctx.publish`, domain events from github, claude and files; source `agents/` (trigger read once by Haiku, rules matched by code, simple schedules, memory file pinned, runs through `owned.start`); board: agent dot with moon, role and reading in the bubble, "Run now", runs inside the agent (no own dots), agent panel with editable role and trigger, run list opening the run's conversation, "New agent …" in the island menu. 30 browser tests. Open: the connections and voice topics (undecided), reply in the bubble (debt #18).
