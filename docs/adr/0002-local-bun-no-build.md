# ADR-0002 — Local-only Bun server, SQLite, board without a build step

**Status:** Accepted · 2026-11-20 (recorded retroactively for stage 1; external services clause amended 2026-11-20)

## Context

Orbit observes Claude Code sessions on one machine. The data — paths, prompts, answers — is private. The tool must start instantly and stay maintainable by one person with AI assistance.

## Decision

- One Bun process (`Bun.serve`) listening on `127.0.0.1` only. No Orbit cloud, no telemetry, no accounts of its own.
- **External services are allowed as integrations**, under three conditions: they run with the user's own, already existing credentials (e.g. the `gh` CLI), they send nothing from Orbit's database or the transcripts, and every write action needs an explicit click in the board. GitHub is the first such integration ([ADR-0006](0006-github-via-gh.md)); more will follow under the same rules.
- State in SQLite via `bun:sqlite` under `~/.orbit`. Schema changes are additive migrations at startup.
- Claude Code reports through a POSIX shell hook that never blocks (one-second timeout, always exit 0).
- The board is plain HTML, CSS and vanilla JS served as static files and polling `/api/state` every two seconds.
- No runtime dependencies.

## Consequences

- `bun start` is the whole setup; nothing to build, nothing to configure.
- Polling is simple and robust, at the cost of up to two seconds of latency.
- The board's code has to stay disciplined without a framework; if it outgrows that, revisit this ADR.

- Integrations make Orbit depend on outside availability; each one must degrade to an error line in the board, never break it.

## Alternatives

- **Electron or a native app.** More reach (menu bar, system notifications) but much heavier; the browser covers stage 1.
- **A frontend framework with a build step.** Not needed at the current size.
- **WebSockets/SSE instead of polling.** Worth it once latency matters; not yet.
