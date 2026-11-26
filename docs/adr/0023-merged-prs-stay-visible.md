# ADR-0023 — Merged pull requests stay visible; sessions whose PR is merged read as done

**Status:** Accepted · 2026-11-23 · amends [ADR-0006](0006-github-via-gh.md)

## Context

The GitHub source lists open pull requests only. When a PR is merged it drops out of the list, its chip disappears from the session, and the user can no longer see that the session's work is finished and that they may close it. Orbit already notices merges (the `pr.merged` domain event, ADR-0020) but keeps nothing.

## Decision

- **The GitHub source remembers merged PRs** in its own table `github_merged` (repo, number, title, url, branch, base, repo folder, workspace, merged at). Rows come from the merge detection between two refreshes and from merges started in Orbit (`github.merge`). Rows older than 14 days are dropped.
- Merged PRs are **PR entities with status `merged`**, no attention, no actions, linked to sessions through the same key as open PRs (`git:<repo dir>#<branch>`). An open PR on the same branch wins over a merged one.
- **On the board** (views only; sources stay apart):
  - the PR chip reads "#7 ✓" in a calm colour; the bubble and the panel say "PR #7 gemergt · vor 2 Std." with the link;
  - a session whose PR is merged and that is not working or waiting is **done**: its dot shows a small check instead of the grey ring — no orange, no edge hint;
  - the action area offers "Erledigt · vom Board nehmen" (with undo, and the worktree offer of ADR-0017);
  - the island menu offers "Erledigte vom Board nehmen · n" with confirmation and undo;
  - when the session works again, the check goes; the merged PR stays as information.

## Consequences

- Finished work is visible at a glance and can be cleared in one click.
- A merge Orbit did not see happen (Orbit was off for days) is not remembered; the PR simply disappears as before.

## Alternatives

- **A `mergedAt` field on the Claude session.** The Claude source would need GitHub knowledge; sources must not know each other (ADR-0007).
- **Ask gh for recently merged PRs on every refresh.** More calls, and the merge detection already exists.
