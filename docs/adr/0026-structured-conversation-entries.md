# ADR-0026 — The conversation separates system-injected messages from what the user typed

**Status:** Accepted · 2026-11-23

## Context

Claude Code writes much more than prompts into the `user` role of a transcript: `<task-notification>` when a background command or agent finishes, slash commands (`<command-name>`, `<command-args>`), `!` commands (`<bash-input>`, `<bash-stdout>`), compaction summaries (`isCompactSummary`). The conversation reader knew only `you`, `ai` and `tool` and stripped a fixed list of tags. Everything else showed up as raw XML in a "you" bubble, as if the user had typed it. Some tool calls also carry state the user cares about — `TodoWrite` is a task list with progress — but they were reduced to the tool name.

Owned sessions run through `claude -p` and write the same transcripts, so one reader covers both kinds of session.

## Decision

- `ConversationEntry` gets a fourth role, `note`: a short German line for something that happened in the session without the user typing it. The board shows it as a neutral system line, never as a "you" bubble.
- Classification is a pure module, `src/sources/claude/entries.ts`, with a closed list of known kinds: background task finished or failed, slash command, `!` command, context compaction, task list progress (`TodoWrite`).
- A user message that consists only of an unknown tag (`<foo>…</foo>`) becomes a neutral note naming the tag, so new Claude Code formats degrade gracefully instead of appearing as user text.
- `ConversationEntry` stays a contract of the `claude` source (served at `/api/conversation`), not of the core.

## Consequences

- The conversation reads as what actually happened; the "pending message" check on the board only compares real `you` entries.
- Deriving session state from these entries (progress, "waits for you — why", running background jobs) and answering questions in owned sessions are later steps that build on this classification; each gets its own decision.
- New Claude Code formats need a line in `entries.ts` to get a good label; until then they are an unnamed note.

## Alternatives

- **Strip all tags, as before.** Loses information (a finished CI run is worth seeing) and keeps leaking unknown formats.
- **Send the raw blocks and classify in the board.** Puts knowledge of Claude Code's transcript format into the frontend, against ADR-0008 (sources provide data, views render).
