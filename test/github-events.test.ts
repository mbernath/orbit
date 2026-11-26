// ADR-0020: domain events from consecutive PR refreshes.
import { expect, test } from "bun:test";
import type { PullRequest, RepoState } from "../src/sources/github/gh";
import { diffPrs } from "../src/sources/github/events";

const pr = (number: number, ci: PullRequest["ci"] = "pass"): PullRequest => ({
  number, title: `PR ${number}`, url: "", branch: `feat/${number}`, author: null, isDraft: false, ci, mergeable: false, blockedReason: null, needsAttention: false, mine: true, reviewRequested: false,
});
const repo = (prs: PullRequest[], error: string | null = null): RepoState => ({
  workspaceId: "acme", dir: "/w", repo: "acme/shop", prs, mergeMethods: ["squash"], error, fetchedAt: 1,
});

test("The first fetch is the baseline: nothing is new", () => {
  expect(diffPrs(null, [repo([pr(1)])])).toEqual({ events: [], vanished: [] });
});

test("New PR, CI turns red, a PR vanishes from the list", () => {
  const { events, vanished } = diffPrs([repo([pr(1), pr(2, "pending")])], [repo([pr(2, "fail"), pr(3)])]);
  expect(events).toEqual([
    { type: "ci.failed", repo: "acme/shop", workspaceId: "acme", number: 2, branch: "feat/2" },
    { type: "pr.opened", repo: "acme/shop", workspaceId: "acme", number: 3, branch: "feat/3", title: "PR 3" },
  ]);
  expect(vanished).toEqual([{ repo: "acme/shop", workspaceId: "acme", number: 1, branch: "feat/1", title: "PR 1", url: "", dir: "/w" }]);
});

test("CI staying red brings no second ci.failed; a gh outage does not read as \"all closed\"", () => {
  expect(diffPrs([repo([pr(2, "fail")])], [repo([pr(2, "fail")])]).events).toEqual([]);
  expect(diffPrs([repo([pr(1)])], [repo([], "gh is not logged in")])).toEqual({ events: [], vanished: [] });
  expect(diffPrs([repo([], "broken")], [repo([pr(1)])])).toEqual({ events: [], vanished: [] });
});
