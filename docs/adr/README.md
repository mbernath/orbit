# Architecture Decision Records

Every structural decision about Orbit is recorded here — not in a chat log, not only in the code. An ADR explains **why** something is the way it is, so the decision can be assessed later and, if need be, reversed with a stated reason.

## When to write one

When a decision is hard to reverse, shapes the data model or the architecture, adds a dependency, or discards an obvious alternative. Not for things the code itself already shows.

## Format

File name `NNNN-short-title.md`, numbered consecutively. Keep it short — a screen is plenty:

```markdown
# ADR-NNNN — <decision as a statement>

**Status:** Accepted · YYYY-MM-DD

## Context
What forces the decision.

## Decision
What we do.

## Consequences
What follows, good and bad.

## Alternatives
What we did not do, and why.
```

An ADR is **not edited** when the decision changes. It gets the status `Superseded by ADR-NNNN`, and the new ADR names what it replaces.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-repository-language.md) | The repository is English, the product speaks German | Accepted |
| [0002](0002-local-bun-no-build.md) | Local-only Bun server, SQLite, board without a build step | Accepted; external services clause amended for integrations |
| [0003](0003-import-existing-transcripts.md) | Existing sessions are imported read-only from Claude Code transcripts | Accepted |
| [0004](0004-card-titles-and-canvas-positions.md) | Card titles come from the transcript; canvas positions live in the database | Accepted; position part superseded by ADR-0008 |
| [0005](0005-inactive-and-archive.md) | Inactive sessions stay on the board until archived by hand | Accepted |
| [0006](0006-github-via-gh.md) | GitHub pull requests through the user's `gh` CLI, merge on explicit click | Accepted |
| [0007](0007-core-and-sources.md) | A small core with pluggable sources; push updates over SSE | Accepted, implemented |
| [0008](0008-canvas-model.md) | Canvas model: entities, elements and views | Accepted |
| [0009](0009-actions-and-local-security.md) | One action layer for every write; the local server authenticates the board | Accepted |
| [0010](0010-observed-and-owned-sessions.md) | Observed sessions stay read-only; interaction runs through sessions Orbit owns | Accepted; runtime amended by ADR-0019 |
| [0011](0011-markdown-files.md) | Markdown files are pinned onto the canvas and edited with conflict protection | Accepted |
| [0012](0012-frames-and-deterministic-layout.md) | Islands are fixed frames; text placement never changes geometry; layout is a pure function | Accepted |
| [0013](0013-minimap-and-edge-hints.md) | A minimap and edge hints replace the "Braucht dich" sidebar | Accepted |
| [0014](0014-session-fixes-and-merges-its-pr.md) | A session can be told to fix its PR and merge it once green | Accepted |
| [0015](0015-agents.md) | Agents are lasting entities; each of their runs is a session | Accepted |
| [0016](0016-agent-triggers.md) | Agent triggers: free text read once by an LLM into a fixed rule schema, evaluated deterministically | Accepted |
| [0017](0017-worktrees-and-model-choice.md) | The board shows where a session works and lets the user choose its model | Accepted |
| [0018](0018-playwright-for-board-tests.md) | Playwright as a dev dependency for board interaction tests | Accepted |
| [0019](0019-owned-sessions-via-claude-cli.md) | Owned sessions run through the headless Claude Code CLI with the user's own login | Accepted |
| [0020](0020-agents-source-core-contracts.md) | Agents as a source: actions across sources, domain events, simple schedules, memory as a Markdown file | Accepted |
| [0021](0021-attachments.md) | Attachments in messages to owned sessions | Accepted |
| [0022](0022-board-dom-ownership.md) | Board DOM: one owner per piece of state, write only on change, measure off-screen | Accepted |
| [0023](0023-merged-prs-stay-visible.md) | Merged pull requests stay visible; sessions whose PR is merged read as done | Accepted |
| [0024](0024-session-pr-link-by-authorship.md) | In a shared checkout, a session is linked to a PR only for branches it worked on itself | Accepted |
| [0025](0025-run-defaults-per-island.md) | Model, thinking and mode have a default per island, taken from Claude's settings unless set | Accepted |
| [0026](0026-structured-conversation-entries.md) | The conversation separates system-injected messages from what the user typed | Accepted |
| [0027](0027-wait-reason-and-progress.md) | A waiting session says why it waits; its task list shows progress | Accepted |
| [0028](0028-answer-questions-and-plans-in-owned-sessions.md) | Questions and plans of owned sessions are answered on the board | Accepted |
| [0029](0029-markdown-it-renderer.md) | The board renders Markdown with markdown-it, vendored as one ES module | Accepted |
| [0030](0030-open-local-files-from-text.md) | Local file references in rendered text open the file | Accepted |
| [0031](0031-stale-hook-install-notice.md) | The board says when the installed hook lacks events | Accepted |
| [0034](0034-selection-align-distribute.md) | Several elements: selection by ⇧-drag, group move, grid, align and distribute per island | Accepted |
| [0038](0038-island-pr-pill.md) | PRs without a session show as one pill beside the island's "+" | Accepted |
| [0040](0040-file-preview.md) | A click on a file reference previews it in Orbit | Accepted |
| [0042](0042-island-panel-and-add-menu.md) | "+" only adds; the island gets a panel; one dialog component | Accepted |
| [0043](0043-keys-by-context.md) | Keys by where they work; one table; Snooze is ⌘⇧S | Accepted |
| [0044](0044-working-line-and-stop.md) | Owned sessions: a working line in the panel; Stop interrupts the turn, not the process | Accepted |
| [0045](0045-colour-swatches-in-text.md) | Colour codes in rendered text get a swatch with a copy popover | Accepted |
