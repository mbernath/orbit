# ADR-0038 — PRs without a session show as one pill beside the island's "+"

**Status:** Accepted · 2026-11-24 · resolves debt #25, refines [ADR-0006](0006-github-via-gh.md), [ADR-0023](0023-merged-prs-stay-visible.md)

## Context

A PR is shown only at the session working on its branch. A PR with no such session — opened by a colleague or a bot, or
whose session is gone or taken off the board — does not appear on the board, even when it needs the user.

## Decision

1. **Whose PR.** The GitHub source asks `gh api user` once for the viewer's login. Each PR carries `mine` (author is the
   viewer, or the viewer is unknown) and `reviewRequested` (the viewer is among the requested reviewers).
2. **Attention.** Own PRs as before: red CI, or mergeable. Someone else's PR needs the user only when their review is
   requested (`level: "review"`, "Review angefordert"); its CI and mergeability are its author's business.
3. **Orphans.** An open PR of an island is an orphan when no session linked to it is on the board (not archived).
   Only orphans that need the user are shown.
4. **One pill, more stacked behind.** Beside the island's "+": the most urgent orphan as a pill with a word, not its
   number — "CI rot", "mergebar", or "Review · <author>" for someone else's PR (outlined, not filled). Hover shows
   `#n title`. Order: red CI, mergeable, review.
5. **A session's PRs.** A session whose branches led to several PRs shows its open ones, most urgent first (as at the island) then newest, and only the
   newest merged one when none is open (`sessionPrs`). The first is what its chip, PR row and merge button act on.
   "Shown at a session" means in that session's PRs, not merely linked — otherwise a second open PR is hidden both
   at the session and from the pill.
6. **Stacks, the same at both places** (amended 2026-11-25, replaces the "+x" to GitHub's PR list). One PR: the chip
   opens it on GitHub. More: an offset rounded box lies behind the chip, hover says "n PRs", and a click lists them
   all in a small menu at the chip (word, `#n`, title; each opens GitHub). The list names exactly the meant PRs,
   which GitHub's repo-wide list did not. Drawn by `web/js/pr-stack.js` for the island pill and the session chip.
7. Derived in the board (`web/js/orphan-prs.js`, pure); no new entity, element or core change.

## Consequences

- Foreign PRs at a session lose their orange for red CI — intended, it is not the user's to fix.
- The pill is not part of the atlas level, the minimap, the edge hints or W/Q (it has no element). Written down as debt.

## Amendment 2026-11-25 — the number, not a word

Point 4's word ("ready to merge") did not say *which* PR, and the stack's menu repeated it before each title under an
"n PRs" header that explained nothing. Now:

- The pill shows the most urgent orphan's **number** (`#418`), as a session's chip does. Its state is the colour:
  filled red for CI failing, filled orange for ready to merge, outlined orange for a requested review. Hover:
  "<word> · <title>", plus "n more PRs, click to list" on a stack.
- The menu has **no header**. Each row: the number as a small chip in its state's colour, then the title; the state's
  word on hover.
