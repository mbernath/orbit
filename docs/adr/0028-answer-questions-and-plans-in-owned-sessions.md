# ADR-0028 — Questions and plans of owned sessions are answered on the board

**Status:** Accepted · 2026-11-23 · builds on [ADR-0019](0019-owned-sessions-via-claude-cli.md) and [ADR-0027](0027-wait-reason-and-progress.md)

## Context

An owned session (`claude -p --permission-prompt-tool stdio`) sends every tool that needs the user as a `can_use_tool` control request. Orbit offered only Erlauben/Ablehnen. For `AskUserQuestion` that is useless (Claude wants a choice, not a permission), and for `ExitPlanMode` the user could not see the plan they were approving.

Probed against the real CLI on 2026-11-23 (recorded in `test/fixtures/claude-stream/ask-question.jsonl` and `plan-approve.jsonl`):
- `AskUserQuestion` arrives with `input.questions` (question, header, options with label and description, multiSelect). The answer is `allow` with `updatedInput = { ...input, answers: { "<question>": "<label>" } }`; Claude then continues with that choice.
- `ExitPlanMode` arrives with an **empty** input in current CLIs. Before it, Claude writes the plan with `Write` to `~/.claude/plans/<name>.md`; the content is in that tool call in the stream.

## Decision

- `owned/stream.ts` classifies a request as `permission`, `question` (with normalised questions) or `plan` (with the plan text from the input, else from the last `Write` to a `.claude/plans/*.md` path in the stream). Orbit never reads the plan file — `~/.claude` stays off limits.
- `owned.answer` takes optional `answers` (question → text). Allowing a question without an answer is refused ("Bitte eine Antwort wählen.").
- Board (`web/js/views/ask.js`): a single single-choice question is answered with one click on an option, in the bubble and in the panel. The panel adds a free-text answer per question and an "Antworten" button (also for several questions and multi-select, whose labels are joined with ", "). A plan shows its first line in the bubble and the whole Markdown in the panel; "Freigeben" allows, "Ablehnen" denies with the user's feedback as the message.
- Observed sessions stay read-only (ADR-0010).

## Consequences

- Plan mode and questions work end to end in owned sessions without switching to the terminal.
- If a CLI version stops writing plans to `.claude/plans`, the plan block shows only "Plan zur Freigabe"; approving still works.
- The answer format follows the CLI's current behaviour; a change there shows up as Claude not getting the choice (the fixtures document what was recorded).

## Alternatives

- **Answer questions by denying with the choice as message.** Works with any CLI, but Claude reads it as a refusal and often asks again.
- **Read the plan file.** Would need an exception to the `~/.claude` rule (ADR-0009) for no gain, since the stream carries the text.
