# ADR-0010 — Observed sessions stay read-only; interaction runs through sessions Orbit owns

**Status:** Accepted · 2026-11-22 · amended by [ADR-0019](0019-owned-sessions-via-claude-cli.md)

## Context

The user wants to zoom into a session and interact with it. Sessions in VS Code, Conductor or a terminal belong to those programs; Orbit only sees them through hooks and transcripts. Feeding keystrokes into foreign terminals or IDE panels would be fragile and invisible to the program that owns the session.

## Decision

- Every session entity has an **ownership**: `observed` (another program runs it) or `owned` (Orbit runs it through the Claude Agent SDK).
- Observed sessions can be watched in detail — the transcript rendered live in the zoomed view — but not controlled.
- "Take over" resumes an observed session in Orbit via the SDK's `resume` with its session ID, after the user confirms; from then on it is owned. Orbit warns if the original program still has it open.
- Owned sessions accept prompts, answer permission requests and can be interrupted from the board; all of that goes through the action layer (ADR-0009).
- Cloud workers (ADR to follow once their kind is decided) are a third ownership, `remote`, controlled through their own channel (e.g. GitHub comments).

## Consequences

- Clear, honest boundary in the UI: the user always sees whether a click can reach the session.
- Owned sessions need Orbit to keep running; a server restart must reattach or mark them as interrupted.

## Alternatives

- **Inject input into terminals (tmux/AppleScript).** Works sometimes, breaks silently, invisible to the owning program.
- **Only owned sessions, no observation.** Would give up the core value of stage 1.
