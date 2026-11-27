# Orbit — context for agents

Orbit is a local control centre for Claude Code sessions across several workspaces. See the README for goal and roadmap.

## Language

**Everything is English — repository and product** ([ADR-0001](docs/adr/0001-repository-language.md), [ADR-0039](docs/adr/0039-english-product-language.md)). No i18n.

- **English:** code, comments, identifiers, documentation (README, this file, ADRs), commit messages, log and console output, and everything the user sees in the board — labels, hints, notifications, API error messages.
- **Terms and voice** for anything the user reads: [docs/design/copy.md](docs/design/copy.md).
- **The conversation follows the user's language.** The language of a request never decides the language of the artefact: a German request for a comment produces an English comment.

## Layout
- `src/server.ts` — composition root: core plus sources, nothing else.
- `src/core/` — the core ([ADR-0007](docs/adr/0007-core-and-sources.md)):
  - `types.ts` — **all contracts**: `Source`, `Entity`, `Element`, `ActionDefinition`, API payloads. The board imports them via JSDoc.
  - `core.ts` — HTTP routing, SSE (`/api/stream`), `/api/state`, `/api/actions/:id`, serving the board with its token.
  - `db.ts` (per-source migrations), `actions.ts` (action layer), `canvas.ts` (elements), `security.ts` (host/origin/tokens), `workspaces.ts`, `runner.ts`, `util.ts`.
- `src/sources/<name>/` — one folder per source, `index.ts` exports `create<Name>Source()`:
  - `claude/` — hook intake (`POST /events`), transcript import, session entities. `hook-setup.ts` holds the hook event list shared with the installer and the stale-install check ([ADR-0031](docs/adr/0031-stale-hook-install-notice.md)).
  - `github/` — repo discovery, PR entities, merge through `gh`.
  - `files/` — pinned Markdown files: read, save with hash check, path limits in `paths.ts` ([ADR-0011](docs/adr/0011-markdown-files.md)).
  - `owned/` — sessions Orbit runs itself through `claude -p` ([ADR-0019](docs/adr/0019-owned-sessions-via-claude-cli.md)): `stream.ts` reads the CLI's stream (pure), `session.ts` one process with its queue, `index.ts` actions and the `control` entity linked to the session by the key `claude:<id>`. `defaults.ts` run defaults per island, from Claude's settings unless set ([ADR-0025](docs/adr/0025-run-defaults-per-island.md)). Tests replay recorded streams from `test/fixtures/claude-stream/` through `replaySpawner` (`test/helpers.ts`), never the real CLI.
  - `lists/` — list nodes ([ADR-0036](docs/adr/0036-list-script-contract.md)): a command configured per island prints a list in the contract of `contract.ts` (pure); `index.ts` runs it in the island's folder, keeps the last good list, refreshes on an interval. Demo: `scripts/orbit-list-demo.sh`. The guide for script authors, `docs/list-contract.md`, is copied from the board — keep it in step with `contract.ts`.
  - `agents/` — agents ([ADR-0020](docs/adr/0020-agents-source-core-contracts.md)): `rules.ts` validates, matches and schedules trigger rules (pure), `reader.ts` reads a free-text trigger once via `claude -p` (haiku), `index.ts` actions, runs through `ctx.act("owned.start")`, memory file `.orbit/agents/<slug>.md`.
- Sources talk through the core only: `ctx.publish` for domain events (closed list in `types.ts`), `ctx.act` for another source's actions (actor `system`, local actions only).
- `hooks/orbit-hook.sh` — POSIX shell hook, sends the hook JSON plus Git info and the hook token. Must never block Claude.
- `scripts/install-hooks.ts` — adds the hook idempotently to `~/.claude/settings.json`.
- `web/` — board as native ES modules, no build step, `// @ts-check` everywhere:
  - `js/main.js` wiring and generic interaction handlers, `api.js` the only server access, `store.js`, `canvas.js` (pan/zoom/drag), `render.js` (elements), `layout.js` (pure auto-layout), `sidebar.js`, `dialogs/`.
  - `js/views/` — one module per view, registered in `registry.js`. Simple views return HTML from `render` and declare interaction via `data-action` / `data-dialog` / `data-edit`; views with their own state (e.g. `file-doc.js`) use `mount`/`update`/`unmount`.
  - `js/markdown.js` — Markdown rendering through markdown-it, vendored in `web/vendor/` ([ADR-0029](docs/adr/0029-markdown-it-renderer.md)); raw HTML escaped, http(s) links only. Local file references become file links (`file-ref.js` recognises, `file-links.js` opens through `files.open`, [ADR-0030](docs/adr/0030-open-local-files-from-text.md)). Colour codes get a swatch (`color-ref.js` recognises, `md-colors.js` renders, `color-pop.js` the popover, [ADR-0045](docs/adr/0045-colour-swatches-in-text.md)).
  - First run ([ADR-0041](docs/adr/0041-first-run-and-onboarding-hints.md)): `first-run.js` folder suggestions on the empty board (`GET /api/claude/folders`, `src/sources/claude/folders.ts`), `hook-notice.js` also the quiet no-hook line, `hints.js` the hints table with progress in `localStorage`.
- `docs/adr/` — architecture decisions. **Read them before changing anything structural.**
- `docs/design/` — design specification of the board (principles, canvas, elements, interaction, copy) with acceptance criteria. **Read it before changing anything in `web/`.** `prototype.html` there is the interactive reference prototype — try it, do not copy its code.
- `docs/architecture-debt.md` — known shortcuts with the trigger that makes each one due.

**Adding a feature usually means:** a new folder under `src/sources/`, its entities and actions, one or more view modules under `web/js/views/`, tests with a stubbed runner. If it needs a change in `src/core/`, that is a contract change — say so and write an ADR.

## Architecture guidelines

These keep the system clean while it grows fast. Each has an ADR with the reasoning.

1. **Core plus sources** ([ADR-0007](docs/adr/0007-core-and-sources.md)). The core owns database, migrations, events, actions, canvas and HTTP. Every kind of data (Claude sessions, transcripts, GitHub, files, MCP mailbox, cloud workers) is a source module behind one interface. A new feature adds a module; it does not add special cases to the core. Modules talk through the core, never through each other's internals.
2. **Entities, elements, views** ([ADR-0008](docs/adr/0008-canvas-model.md)). Sources provide *entities* (data, addressed by a ref like `session:claude/<id>`). The canvas holds *elements* that show an entity in a *view* (card, compact, panel, editor, live …). Geometry, grouping and archive state belong to elements, never to entities. Sources never produce HTML; views are registered in the frontend per entity kind.
3. **Versioned migrations per source.** Each source (and the core) has its own numbered list, tracked in `schema_migrations`; tables are prefixed with the source id (`claude_sessions`). Applied migrations are never edited.
4. **Every write goes through the action layer** ([ADR-0009](docs/adr/0009-actions-and-local-security.md)): permission check, log entry in `events`, confirmation for anything irreversible or outward-facing. Agents (MCP) may send messages, never trigger outward actions.
5. **The local server is not trusted by default** ([ADR-0009](docs/adr/0009-actions-and-local-security.md)): check `Host` and `Origin`, mutating requests need the board's token.
6. **File access has hard limits** ([ADR-0009](docs/adr/0009-actions-and-local-security.md)): only inside workspace paths, only `.md`, never `.git` or `~/.claude`; write only if the content hash still matches what was loaded, and write atomically.
7. **Observed vs. owned sessions** ([ADR-0010](docs/adr/0010-observed-and-owned-sessions.md)): Orbit never injects input into sessions it does not run. Interaction goes through sessions Orbit starts or resumes via the Agent SDK, and the board always shows which is which.
8. **Push, not poll**, for anything interactive: Server-Sent Events from the core ([ADR-0007](docs/adr/0007-core-and-sources.md)).
9. **Frontend as native ES modules**, no build step: one module per view and per UI area, a small store, API calls in one place.
10. **Size limits as a signal:** a file over ~300 lines, a function over ~50 lines, or a third copy of the same logic means split or extract *before* adding more.
11. **Types at the boundary:** contracts live once in `src/core/types.ts`; `bun run typecheck` checks server, tests and board (`// @ts-check` with JSDoc in every board module).
12. **Per feature: ADR → tests → code.** Refactoring and feature work are separate steps, never one diff.

## Architecture check (every task)

We build fast, so the architecture is questioned continuously, not once.

- **Before coding:** does the change fit the guidelines and ADRs? If it needs a special case in the core, a new concept without an ADR, or reaching into another module, stop and say so.
- **After coding:** look at what you touched against the signals — size limits, duplicated logic, a module knowing another's internals, a core change made for one source, a test that needed the real outside world, a shortcut you took.
- **Report it in your answer** under a short heading *Architektur-Check*: either "keine Auffälligkeiten" or concrete findings, each with a proposal — a refactoring (scoped, as its own step), a new or superseding ADR, or an entry in [docs/architecture-debt.md](docs/architecture-debt.md) with the trigger that makes it due.
- **Never refactor silently** and never mix it into a feature diff. Propose, let the user decide, then do it as its own step.
- Shortcuts are allowed when speed matters — but every shortcut is written down in the debt list, never left implicit.

## Rules
- Server on `127.0.0.1` only, no telemetry. External services only as integrations with the user's own credentials, never sending Orbit's data, writes only on an explicit click ([ADR-0002](docs/adr/0002-local-bun-no-build.md)). GitHub runs through `gh` ([ADR-0006](docs/adr/0006-github-via-gh.md)).
- Tests never call real external services: pass a stub `run` or `github: false` to `createOrbit`, and `boardToken` for a fixed token (see `test/helpers.ts`).
- The hook must always be fast and exit with code 0.
- No dependencies without good reason. Prefer Bun built-ins (`bun:sqlite`, `Bun.serve`).
- Workspace assignment is computed on read, not stored, so edits to `workspaces.json` take effect immediately.
- **Claude Code's transcripts under `~/.claude/projects` are read-only for Orbit.** Tests use their own directory (`claudeProjects` option), never the real data.
- Run `bun run verify` (type check + tests) before every commit, and `bun run test:e2e` (Playwright, ADR-0018) when `web/` changed. Browser tests start their own server with a temporary data directory (`test/e2e/serve.ts`).
- Browser screenshots: the board keeps an SSE connection open, so headless Chrome's `--virtual-time-budget` never finishes. Use `--timeout=5000` and stop Chrome after a fixed wait.

## Working together
- **The user makes the fundamental decisions.** For structural questions (data model, new dependency, architecture) present options with pros and cons, give a recommendation, then let them decide.
- **Every structural decision becomes an ADR** in [docs/adr/](docs/adr/) — not just a chat message. Short is fine; see the template there.
- **Done means machine-verifiably done.** A new or previously failing test turns green; for UI changes also a screenshot from a real browser. If no such criterion exists, formulating it is part of the task. "Looks right" is not an acceptance criterion.
- **Git: commit only when the user says so** — no routine commits, no pushes unasked. Personal agreements (branching, commit habits, conversation language) belong in your own gitignored `CLAUDE.local.md`.

## How AI assistants work here
- **Change single files with the Edit tool** (or Write for a full rewrite), never with a `python3`/`node`/`sed` heredoc that reads, substitutes and writes back. A `.replace()` that matches nothing writes the file back unchanged and exits 0 — a silent failure. Edit reports it.
- **Read JSON with `jq`, search code with `rg`**, not with inline scripts.
- **Temporary files go to the scratchpad or `$TMPDIR`**, never to `/tmp` and never into the repo.
