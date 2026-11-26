# ADR-0006 — GitHub pull requests through the user's `gh` CLI, merge on explicit click

**Status:** Accepted · 2026-11-20 · amended by [ADR-0014](0014-session-fixes-and-merges-its-pr.md), [ADR-0023](0023-merged-prs-stay-visible.md), [ADR-0024](0024-session-pr-link-by-authorship.md)

## Context

Many workspaces contain GitHub repos. The user wants to see open pull requests, their CI state and whether they can be merged — and merge from the board. ADR-0002 allows integrations that use the user's own credentials.

## Decision

- **Discovery:** each workspace folder and up to two levels below it are searched for `.git`; `git remote get-url origin` yields `owner/name`. Non-GitHub remotes are ignored.
- **Data via `gh`:** `gh pr list --json …` per repo, server-side, every 60 s and on demand ("PRs aktualisieren"). The board keeps polling `/api/state` and only reads the cache. No token handling, no dependency.
- **Summary per PR:** CI (`pass`/`fail`/`pending`/`none` from `statusCheckRollup`), `mergeable` only for `mergeStateStatus` `CLEAN` or `HAS_HOOKS` and not draft, otherwise a German reason (Konflikte, Review fehlt, Checks laufen, …).
- **"Braucht dich"** lists PRs with red CI and mergeable PRs.
- **Session link:** a session whose repo (or worktree of it) and branch match an open PR shows a PR chip.
- **Merge:** only from a confirmation dialog. Squash is preselected with "delete branch" checked; only methods the repo allows are offered. The server re-checks that the PR is currently shown as mergeable and the method is allowed, then runs `gh pr merge <n> --repo <owner/name> … ` from a **neutral working directory**, so gh never switches or touches a local checkout or worktree.
- No auto-merge.

## Consequences

- Works wherever `gh` is logged in; without `gh` the panel shows an error line instead of PRs.
- Up to one minute of lag for PR state; the merge itself refreshes immediately.
- A merge from Orbit bypasses any approval rules of Claude Code — intended, because it is the user's own click.

## Alternatives

- **GitHub REST/GraphQL with an Orbit token.** More control, but token storage and a second login for no gain.
- **Merging inside the local repo (`gh pr merge` without `--repo`).** gh would check out the default branch in that checkout — dangerous with sessions working there.
- **Polling from the browser.** Would multiply GitHub calls per open tab.
