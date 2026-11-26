# ADR-0024 — In a shared checkout, a session is linked to a PR only for branches it worked on itself

**Status:** Accepted · 2026-11-23 · amends [ADR-0006](0006-github-via-gh.md) (session link)

## Context

Sessions and PRs are linked by the key `git:<repo dir>#<branch>`. The branch comes from the hook (the checkout's current branch) or, for imported sessions, from the transcript, where Claude Code records the checkout's branch on every entry. In a worktree the branch belongs to one session. In the shared main checkout it does not: when one session switches the checkout to its branch, every other session there records that branch too and inherits its PR. On one board, two sessions of the same repo showed PR #488; only one had created it.

## Decision

- **Own worktree:** the link stays by branch, as before.
- **Main checkout:** a session is linked only to branches it **worked on itself**, read from its transcript (read only, ADR-0003): it created the branch (`git checkout -b`, `git switch -c`, `git worktree add -b`), pushed it (`git push … <branch>`, `-u origin <branch>`), or opened a PR for it (`gh pr create … --head <branch>`, or `gh pr create` while on that branch).
- The claude source keeps these branches per session (`claude_sessions.own_branches`) and updates them when the transcript changes (Stop hook, import). Only they become `git:` keys.
- The board is unchanged; a session in the main checkout without such evidence simply shows no PR.

## Consequences

- No more PRs at sessions that only happened to share the checkout.
- A session that continued work on a branch without creating or pushing it shows no PR chip. Rare in the main checkout, and better than a wrong link.

## Alternatives

- **Link the PR only to the most recent session on its branch.** Still guesses; the wrong session can be the most recent.
- **Keep the branch link and warn.** The wrong link would remain, including "Beheben und mergen" for the wrong session.

## Amendment 2026-11-25 — no link lost with a lost hook event

A session in the main checkout pushed two branches and opened their PRs, but the following Stop events never reached
Orbit (no hook event at all arrived for hours); both PRs showed as orphans at the island. Now:

- A `PostToolUse` of a Bash command that creates, pushes or opens a PR for a branch adds that branch at once
  (`branchesOf` on the command), without waiting for the turn's Stop.
- The claude source re-imports changed transcripts every 60 s (`claudeImportMs`, unchanged files skipped by
  mtime/size), so whatever a lost hook would have told is read from the transcript. This is server-side catch-up from
  local files, not polling by the board; the board is still pushed over SSE.
