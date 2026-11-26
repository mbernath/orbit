# ADR-0014 — A session can be told to fix its PR and merge it once green

**Status:** Accepted · 2026-11-22 · amends [ADR-0006](0006-github-via-gh.md)

## Context

ADR-0006 lets the user merge a mergeable PR from the board, only after an explicit confirmation, and rules out auto-merge. When a PR cannot be merged (CI red, conflicts, review missing), the user's actual workflow is to tell the session that owns the branch to fix the problem and merge afterwards. Doing that by typing the same instruction every time is friction, and the board already knows the PR, its state and its session.

## Decision

- A PR that needs attention and is not mergeable offers two actions wherever the PR is shown (bubble and detail panel): **"Beheben und mergen"** and **"Nur beheben"**.
- Both send a prompt to the session that owns the PR's branch, naming the PR and the reason (e.g. "PR #31: CI rot, 2 Tests. Bitte beheben und danach per Squash-Merge in main mergen."). The prompt appears in the conversation like any other message from the user.
- With "und mergen", **the session** merges, with its own tools (`gh pr merge`) and its own permission rules. Orbit does not merge on its own and does not watch for green CI to merge. This is a delegated instruction, not auto-merge in the sense of ADR-0006.
- Only sessions Orbit can talk to can receive it (`owned`, `remote`, ADR-0010). For an `observed` session the PR row says it has to be taken over first.
- While the session works on it, the PR row shows that and the PR leaves the attention set (no edge hint, no orange), so it does not nag twice.
- Every PR number links to the PR on GitHub and opens in a new tab.

## Consequences

- One click for the user's most common PR follow-up; the instruction is visible and editable in the conversation history.
- The merge happens under the session's permissions, so Claude Code's permission prompts still apply; if the session asks, the question shows up as a normal request in its bubble.
- The wording of the prompt is part of the product and should be tuned once real sessions use it.

## Alternatives

- **Orbit merges automatically when CI turns green.** Faster, but it is exactly the auto-merge ADR-0006 rules out, and it would merge without the session having confirmed its fix.
- **Only "Nur beheben", merge stays a manual click.** Safer, but does not match how the user works and keeps them polling the PR.
