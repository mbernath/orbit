# ADR-0032 — Sessions Orbit starts name themselves in their first reply

**Status:** Accepted · 2026-11-23 · builds on [ADR-0019](0019-owned-sessions-via-claude-cli.md)

## Context

A session's title is the custom title, else Claude Code's topic title (`ai-title` in the transcript), else the start of the first prompt. Claude Code writes `ai-title` only for some entrypoints (VS Code extension, TS SDK), not for `claude -p` (`entrypoint: sdk-cli`). Sessions Orbit runs therefore always showed the start of the prompt. A separate model call just for a title was ruled out.

## Decision

- The owned source starts a **new** session with `--append-system-prompt` (`TITLE_PROMPT` in `src/core/util.ts`): the first reply opens with one line `[Titel: <3 to 6 words>]`. Resumed sessions do not get it again.
- The claude source reads that line from the transcript (`readAiTitle`, `parseTranscript`) and uses it as the topic title when Claude Code wrote none. Only the first reply counts.
- The line is stripped wherever a reply is shown: conversation, last message (hook and transcript), and the owned stream's `lastText`.
- The marker and its parser (`splitTitle`) live once in `src/core/util.ts`, since two sources share them.

## Consequences

- No extra call; the cost is a few tokens in a reply that is generated anyway. Probed with haiku on 2026-11-23 (fixture `test/fixtures/claude-stream/titled.jsonl`).
- The model may ignore the instruction; then the prompt start stays, as before.
- The line stays in the transcript, so Claude Code itself (terminal, `--resume`) shows it.
- Observed sessions are untouched (ADR-0010). If the user writes the same instruction into their own `CLAUDE.md`, the claude source picks it up there as well.

## Alternatives

- **Separate haiku call for a title.** Reliable, but an extra call per session.
- **Inject the instruction into observed sessions through the `UserPromptSubmit` hook.** Covers all sessions, but Orbit would put input into sessions it does not run (ADR-0010).
- **Branch name as fallback.** Free, but only helps on feature branches.

## Amendment 2026-11-25 — English marker (ADR-0039)

The prompt now asks for `[Title: …]`. Reading accepts both `[Title: …]` and the old `[Titel: …]`, so sessions started before the change keep their titles.
