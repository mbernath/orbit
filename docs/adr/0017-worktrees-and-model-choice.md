# ADR-0017 — The board shows where a session works and lets the user choose its model

**Status:** Accepted · 2026-11-22 · builds on [ADR-0010](0010-observed-and-owned-sessions.md), [ADR-0015](0015-agents.md) · amended by [ADR-0019](0019-owned-sessions-via-claude-cli.md)

## Context

Sessions and agents work either in the repo's main checkout or in a git worktree on their own branch; two active sessions in the same checkout can overwrite each other's files. The hooks already report `git_root` and branch. The user also wants to pick the Claude model per session where that is possible — owned sessions run through the Agent SDK, which takes a model per session and lets it change between turns; observed sessions run elsewhere; cloud agents are configured by their service.

## Decision

**Worktrees**
- Every session shows where it works: own worktree (path), main checkout, or "in der Cloud". One line in the detail panel meta and in the near bubble; nothing at farther zoom levels.
- Two active sessions (working or waiting) in the same main checkout show a quiet warning naming the other one.
- **Defaults when creating:** every session and agent works in the main checkout on the current branch; Orbit creates no branch. A worktree is chosen on request: either before the first prompt from one quiet line under the prompt field ("Haupt-Checkout · Opus 5.5 · normal"), then Orbit creates `.worktrees/<slug>` on `feat/<slug>` named after the first prompt; or later by asking the session itself (Claude Code can enter a worktree), in which case Orbit simply shows the new location, which the hooks report via `cwd`/`git_root` and branch. For an agent a change applies to its next run.
- **Folders without git:** no worktree choice, no branch, no PR features; the location reads "Ordner ohne Git". Folders with several repos are out of scope for now (the target setup is monorepos).
- When a session with its own worktree is taken off the board, Orbit offers to remove the worktree as well. Never automatically.

**Model**
- Owned sessions and agents: model and thinking effort are one quiet button in the detail panel meta and in the new-session line ("Opus 5.5 · normal"); one small menu lists the models with one word each (thorough / balanced / fast and cheap) and the effort levels (little / normal / thorough). A change applies from the next message and is noted in the conversation.
- Observed sessions show their model (read from the transcript), not changeable. Cloud agents show "Cloud-Agent", no model.
- **Defaults:** task sessions use the most thorough model with normal effort, agents the balanced model with little effort. Defaults are not configurable yet; a settings place for them comes with the first real need.

## Consequences

- File conflicts between parallel sessions become visible before they happen.
- No new UI surface: everything sits in existing places (meta line, near bubble, new-session line, menus).
- Model names in the UI must follow the available models; the list lives in one place.

## Alternatives

- **A worktree for every new session by default.** Safer isolation, but creates branches the user did not ask for; most of their sessions work on the current branch.
- **Model choice as a global setting only.** Simpler, but the user wants cheap models for routine agents and the thorough one for hard tasks at the same time.
- **Model badge on every dot.** Constant noise on the board for a rarely changed property.
