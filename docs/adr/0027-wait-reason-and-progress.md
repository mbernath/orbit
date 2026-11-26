# ADR-0027 — A waiting session says why it waits; its task list shows progress

**Status:** Accepted · 2026-11-23 · builds on [ADR-0026](0026-structured-conversation-entries.md)

## Context

The `PermissionRequest` hook fires for every tool that needs the user, including `AskUserQuestion` (Claude asks something) and `ExitPlanMode` (a plan waits for approval). The board rendered all of them as "Darf ich <Tool>?", so a question read as "Darf ich AskUserQuestion?". Separately, `TodoWrite` carries the session's task list, the best signal for how far a session is, and Orbit ignored it.

## Decision

- `claude/entries.ts` classifies the wait (`waitReason`): `question` with the first question's text, `plan` with the plan's first line, otherwise `permission` with the tool line as before.
- The `claude_sessions` table stores the kind (`question_kind`) next to the question, and the progress of the last `TodoWrite` from `PostToolUse` (`progress`, JSON `{ done, total, current }`). Migration 5.
- The session entity exposes `questionKind` (only while waiting) and `progress`. The board writes "Frage: …" / "Plan zur Freigabe: …" and adds "Aufgaben 2/5" to the status line while the list is unfinished.
- Observed sessions stay read-only (ADR-0010): no answer buttons. Answering questions and approving plans in owned sessions is a separate step.

## Consequences

- Waiting sessions tell what they need without opening them.
- Progress depends on Claude using `TodoWrite`; sessions without a list show none. A finished list (all done) is not shown, so stale lists from earlier turns stay quiet.
- Existing sessions have no kind stored; it defaults to `permission`, which was the previous reading.

## Alternatives

- **Read the wait reason from the transcript on each request.** No migration, but a file read per entity on every state build.
- **Only the Notification text.** Claude Code's notification is a generic English sentence without the question.

## Amendment 2026-11-24: only the asked tool ends the wait

A `PostToolUse` used to end every wait. Claude often runs tools in parallel; one started before the permission prompt can finish while the prompt is still open, and the session showed as working although it needed the user. `PermissionRequest` carries no `tool_use_id`, so the source stores the asked tool as name plus canonical input (`pending_tool`, claude migration 6). Only a `PostToolUse` of that tool ends the wait; without a recorded prompt or without input on either side, the tool name decides. A denied prompt has no `PostToolUse`; the wait then ends with the next `Stop` or `UserPromptSubmit`.
