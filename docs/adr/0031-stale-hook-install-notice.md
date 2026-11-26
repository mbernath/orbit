# ADR-0031 — The board says when the installed hook lacks events

**Status:** Accepted · 2026-11-23 · builds on [ADR-0027](0027-wait-reason-and-progress.md)

## Context

The hook is installed once into `~/.claude/settings.json` by `scripts/install-hooks.ts`. When Orbit starts using a new hook event (e.g. `PostToolUse`, which ends "wartet" after a granted permission), existing installs do not get it until the installer runs again. Nothing told the user: sessions simply stayed on "wartet auf dich" until their turn ended, and the cause was only found by reading the event log.

## Decision

- **One list of events**, `HOOK_EVENTS` in `src/sources/claude/hook-setup.ts`, used by the installer and the check.
- The claude source serves `GET /api/claude/hooks` → `{ missing: string[] }`: events in that list without an `orbit-hook.sh` entry in Claude Code's global `settings.json` (read only, re-read on every request).
- **Only a partial install counts as stale.** No Orbit hook at all is a choice (Orbit without hooks), not a forgotten update, and gets no notice.
- The board shows a lasting notice at the top while something is missing, naming the events and the command (`bun run hooks:install`). It checks on load and whenever the window gets focus again, so it disappears after the installer ran.

## Consequences

- Adding an event to `HOOK_EVENTS` makes every existing install visibly stale until it is updated.
- Hooks configured only in project or local settings are not seen; the installer never writes there.
- Running sessions need a restart after the installer; the notice says so but cannot detect it.

## Alternatives

- **Install the missing hooks from the board.** One click less, but Orbit would write to `~/.claude`, which ADR-0009 rules out.
- **End "wartet" from the owned session's stream** instead of `PostToolUse`. Only covers sessions Orbit runs, and couples the owned and claude sources.

## Amendment 2026-11-25 — no hook at all (ADR-0041)

The check also returns `installed: boolean`. "No hook at all" is still not a stale install and gets no warning, but once an island exists the board shows a quiet line with the install command (docs/design/onboarding.md, stage 2).
