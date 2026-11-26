# ADR-0005 — Inactive sessions stay on the board until archived by hand

**Status:** Accepted · 2026-11-20

## Context

Imported and ended sessions were shown as a separate "history". In practice they are simply inactive work, and the user wants to decide themselves what leaves the board. Claude Code's own transcripts live outside the repo and are purged by Claude Code (`cleanupPeriodDays`, default 30 days); Orbit must not touch them (ADR-0003).

## Decision

- Two session states replace `ended` and `history`: live (`working`, `waiting`, `done`, `idle`) and **`inactive`** (ended or imported). Inactive cards are shown, greyed out.
- **Archiving** is Orbit's way to remove a card: `archived_at` in the database, set per card or in bulk ("Inaktive archivieren" for the current view, with an inline confirmation). Archiving acknowledges the session, so it never waits in "Braucht dich".
- **No automatic archiving.** Cleaning up is a deliberate act.
- The import never changes `archived_at`. Any hook event of an archived session clears it — a resumed session comes back on its own.
- Archived cards can be shown ("Archiv zeigen") and brought back.
- Transcripts are never deleted by Orbit.

## Consequences

- The board shows the real amount of open work until the user cleans up.
- Archived sessions keep title, position and history in Orbit, even after Claude Code purged the transcript.

## Alternatives

- **Automatic archiving after N days.** Rejected: cleaning up should be a conscious decision.
- **Deleting the transcript.** Would also remove the session from the VS Code history and is irreversible; breaks ADR-0003.

## Amendment — 2026-11-25

One exception to "no automatic archiving": an island created from a first-run suggestion keeps only its recent sessions on the board and says so, with Show all / Show none ([ADR-0041](0041-first-run-and-onboarding-hints.md), amendment).
