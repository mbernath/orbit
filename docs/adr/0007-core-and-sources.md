# ADR-0007 — A small core with pluggable sources; push updates over SSE

**Status:** Accepted · 2026-11-20 · implemented 2026-11-20

## Context

Orbit grew from one data source (Claude hooks) to three (hooks, transcripts, GitHub) inside one `server.ts`, and four more are planned: Markdown files, an MCP mailbox for agents, interactive sessions and cloud workers. Each was added as code in the server; continuing that way makes every feature touch everything. The board polls every two seconds, which is too slow for live interaction with a session.

## Decision

**Core** (`src/core/`): database and versioned migrations (per source in `schema_migrations`, so sources migrate independently; tables are prefixed with the source id), event log, action layer (ADR-0009), canvas store (ADR-0008), HTTP routing, SSE hub, workspace registry. The core knows no source by name.

**Sources** (`src/sources/<name>/`): one module per kind of data, all implementing the same contract:

```ts
interface Source {
  id: string;                                  // "claude", "github", "files", "mcp", …
  migrations?: Migration[];                    // own tables, namespaced by source id
  start(ctx: CoreContext): void | Promise<void>;  // subscribe to events, start timers
  entities(query: EntityQuery): Entity[];      // current state, read-only
  actions?: ActionDefinition[];                // writes, executed only via the action layer
  routes?: Route[];                            // source-specific HTTP endpoints (e.g. hook intake)
  stop?(): void;
}
```

`CoreContext` gives a source the database, the event bus, the workspace registry, a command runner (stubbable) and `emit(change)` for SSE. Sources never import each other; if one needs another's data, it reads entities through the core.

**Realtime:** the core keeps an SSE endpoint (`GET /api/stream`); sources call `emit` on change (coalesced to one event per 50 ms), and the board reloads `/api/state`. Sending deltas instead of a change signal is deferred until the state gets large (see debt list).

**Server entry** (`src/server.ts`) only composes core and sources.

## Consequences

- A new feature is a new folder under `src/sources/` plus views in the board; the core changes only when the contract itself must grow — and then with an ADR.
- Each source is testable alone with a fake `CoreContext`.
- Migrating today's code is a dedicated refactoring step with no behaviour change.

## Alternatives

- **Keep growing `server.ts`.** Fastest today, unmaintainable within two features.
- **Separate processes per source.** Isolation is not needed on one machine; costs deployment complexity.
- **WebSockets instead of SSE.** Needed only if the browser streams a lot to the server; commands go over plain POST, so SSE suffices and needs no library.
