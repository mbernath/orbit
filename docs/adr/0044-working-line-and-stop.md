# ADR-0044 — Owned sessions: a working line in the panel; Stop interrupts the turn, not the process

**Status:** Accepted · 2026-11-26 · builds on ADR-0019 (owned sessions via `claude -p`)

## Context

After sending a task to a session Orbit runs, the detail panel showed nothing while Claude worked: the conversation is read from the transcript and only changes when a message lands there, and `RunState.status = "working"` was not shown in the panel at all. There was also no way to stop a turn. The action `owned.stop` existed without a button, and it ended the whole process (stdin closed, killed after 5 s).

The CLI's stream-json input accepts `{"type":"control_request","request":{"subtype":"interrupt"}}` (probed 2026-11-26 with Claude Code 2.1.330, recorded in `test/fixtures/claude-stream/interrupt.jsonl`): it answers with a `control_response`, writes `[Request interrupted by user]` as a user message, ends the turn with `result` / `error_during_execution`, and keeps the process — the next message continues the same session. No Stop hook is sent for an interrupt.

## Decision

1. **Working line.** While an owned session works, its conversation in the panel ends in one line where the answer will appear: a breathing dot, what the turn does, the time since the turn began, and **Stop**. `stream.ts` derives `activity` from the stream (pure): the last block of Claude's message — a tool as "Reading stream.ts", "Editing x.js", "Running bun test", "Searching …", "Agent: …", else "Using <tool>"; a thinking block as "Thinking"; text as "Writing" — and "Thinking" when a tool result comes back. The control entity carries `activity` and `since`. A pending question shows its own row instead. Observed sessions get no working line for now.
2. **Stop interrupts the turn.** `owned.stop` writes the interrupt request; the process and the session stay. If the turn has not ended after 3 s, the process ends as before, and the next message resumes. A stop the user asked for is never shown as an error.
3. **The queue is dropped and returned.** Who stops usually wants to steer again: queued messages are removed and come back to the board, which puts their texts into the reply field before any draft (images of queued messages are lost).
4. **The session reads idle.** Because no Stop hook comes, `owned.stop` calls `claude.stopped` (actor `system`, via `ctx.act`): the Claude source sets the session to idle and seen. The transcript's `[Request interrupted by user …]` reads as the note "Stopped by you" — also for observed sessions stopped with Esc in a terminal.
5. **Key:** ⌘. in the reply field (key table, ADR-0043). No board key.

## Consequences

- `replaySpawner` cuts a recording also before every `control_response`, so an interrupt write releases the CLI's answer. The fake CLI of the browser tests answers an interrupt like the recording.
- `activity` is a guess from the last block; a long tool run shows its tool for the whole time, which is what the user wants to see.
- Removing a worktree and shutting Orbit down still end the process (`stop()`), unchanged.

## Alternatives

- **Keep ending the process.** Simpler, but loses the live process, makes every stop a resume, and the CLI notes nothing in the transcript.
- **Stop in place of a Send button.** The reply field has no Send button (Enter sends); the working line is where the eye waits for the answer.
- **Keep the queue after Stop.** The next message would start at once — usually not what someone stopping wants.
