# ADR-0025 — Model, thinking and mode have a default per island, taken from Claude's settings unless set

**Status:** Accepted · 2026-11-23 · amends [ADR-0017](0017-worktrees-and-model-choice.md) (model choice) and [ADR-0019](0019-owned-sessions-via-claude-cli.md) (mode)

## Context

An owned session that leaves model, thinking or mode unset runs with whatever Claude Code picks. Orbit did not know that value, so the board showed "Standard". The user could not tell what a session actually does (it should have read "normal"). The CLI reports the model at start (`init.model`) but not the thinking effort. Claude Code itself takes these values from its settings files (`~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`), so they can differ per project.

## Decision

- **Every island has run defaults:** model, thinking (effort) and mode. Each value is either **set by the user** for the island or **follows Claude's settings**, which is the default.
- **"Follows Claude's settings"** means Orbit reads, read-only, the keys `model`, `effortLevel` and `permissions.defaultMode` from the island's first folder (`.claude/settings.local.json`, then `.claude/settings.json`) and then `~/.claude/settings.json`. The first value found wins, as in Claude Code. Values are read when needed, not stored, so edits to the settings apply at once.
- **The board never shows "Standard" when Orbit can know the value.** "Neue Session" is pre-selected with the island's defaults; the panel shows the session's own choice, else the island's default. Only when neither Claude's settings nor the island name a value does it stay "Standard". For the model, the CLI's `init.model` still wins once a session runs.
- **What the CLI gets:** a value the user set (for the island or the session) is passed as a flag (`--model`, `--effort`, `--permission-mode`). A value that only follows Claude's settings is **not** passed: the CLI reads its settings itself, so variants Orbit does not list (`opus[1m]`) keep working.
- **Where it lives:** in the owned source (table `owned_island_defaults`, keyed by workspace id), not in `workspaces.json`, so the core's `Workspace` contract stays unchanged ([ADR-0007](0007-core-and-sources.md)). It is changed through an action `owned.setDefaults` (risk `local`, actor `board`) from the island menu.
- **Exception to "never `~/.claude`":** reading these three keys from settings files is allowed. Credentials, transcripts outside the import (ADR-0003) and any write stay forbidden; the files source (ADR-0011) still never opens anything under `~/.claude`.

## Consequences

- The dropdowns show real values ("Opus · normal · Auto"), so the user sees what a session does before and while it runs.
- One island can run cheaper (Haiku, "wenig") than another without touching Claude's own settings.
- Two places can now name a default: Claude's settings and the island. The island wins, and the island menu shows which values are set there and which follow Claude.
- Claude's own built-in defaults (no settings at all) remain unknown; that case still reads "Standard".
- Orbit's mode list has no `bypassPermissions` (ADR-0019). If Claude's settings name it, Orbit shows "fragt immer" and passes `--permission-mode default` explicitly, so an owned session never bypasses permissions.

## Alternatives

- **Only read Claude's settings, no island defaults.** No second place, but no way to run one island differently without editing Claude's project settings.
- **Only island defaults, fixed by Orbit.** Unambiguous, but ignores what the user already configured for Claude, and the VS Code sessions and Orbit's would behave differently.
- **Store the defaults in `workspaces.json`.** Natural place, but makes the core's workspace contract carry one source's settings.
- **Always pass the resolved value as a flag.** The display would match exactly, but Orbit would have to know every value Claude accepts (`opus[1m]`, future models).
