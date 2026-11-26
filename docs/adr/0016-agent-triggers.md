# ADR-0016 — Agent triggers: free text read once by an LLM into a fixed rule schema, evaluated deterministically

**Status:** Accepted · 2026-11-22 · builds on [ADR-0015](0015-agents.md) · amended by [ADR-0019](0019-owned-sessions-via-claude-cli.md) · implemented by [ADR-0020](0020-agents-source-core-contracts.md)

## Context

Agents (ADR-0015) run when something happens: after a merge, on every new PR, on a schedule. The user wants to state that in their own words, also by voice, in German and English mixed. A Claude Code session cannot wait for events by itself: it is turn-based and only works when a message arrives; polling in a loop burns tokens, grows the context and dies with the session. So something outside the session has to wake it — Orbit's core, which already receives hook events and polls GitHub (ADR-0006, ADR-0007).

## Decision

- **A trigger is a rule in Orbit's core**, not an instruction to a session. When an event matches a rule, the core starts a run of the agent: a new owned session (Agent SDK) with the agent's role and the event payload as prompt (ADR-0015).
- **Rule schema** (fixed vocabulary): `kind` = `event` | `schedule` | `manual`; for events `type` from a closed list (`pr.opened`, `pr.merged`, `ci.failed`, `session.done`, `file.changed`, …) plus optional filters (repo, branch, path glob); for schedules a cron expression and time zone.
- **Text → rule once, by an LLM, at create or edit time.** The free text goes to a small structured-output call that must return the schema or "not understood". Orbit shows the reading back in plain German ("Läuft: nach jedem Merge in main") where the trigger is edited. Not understood → the agent runs manually only, and says so in its bubble.
- **Evaluation is deterministic code.** Matching an event against rules never calls an LLM: fast, free, explainable, testable. Every firing is written to the event log with the rule that matched.
- Fuzzy conditions ("only PRs that touch the data model") are out of scope for now; if needed later, they become an explicit, opt-in LLM filter step after the deterministic match.

## Consequences

- Triggers work offline and predictably; the LLM is only needed when a trigger is created or changed, and its output is visible and correctable.
- The event vocabulary must grow deliberately; a new event type is a code change in a source plus an entry in the schema.
- Schedules need a timer in the core (or delegation to a cloud routine for remote agents).

## Alternatives

- **Tell a session to wait for events.** Not possible without polling inside the session; fragile and expensive.
- **Only fixed phrases, no LLM.** Predictable but brittle with natural and mixed-language input.
- **LLM decides on every event whether a trigger fires.** Flexible, but costly, slow and not reproducible.
