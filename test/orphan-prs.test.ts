// PR stacks (web/js/orphan-prs.js) against ADR-0038: PRs without a session per island, and a session's own PRs.
import { expect, test } from "bun:test";
import type { ResolvedEntity } from "../src/core/types";
import { orphanPrs, sessionPr, sessionPrs } from "../web/js/orphan-prs.js";

const pr = (n: number, attention: ResolvedEntity["attention"], data: Record<string, unknown> = {}, status = "blocked"): ResolvedEntity => ({
  ref: `pr:github/acme/shop#${n}`, kind: "pr", source: "github", title: `PR ${n}`, status, workspaceId: "a", paths: [], keys: [],
  attention, parent: null, updatedAt: 0, actions: [], related: [],
  data: { repo: "acme/shop", number: n, url: `https://github.com/acme/shop/pull/${n}`, mine: true, ...data },
} as ResolvedEntity);
const none = () => false;

test("Only PRs without a session that need you", () => {
  expect(orphanPrs([pr(1, null), pr(2, { level: "ready", text: "ready to merge" })], (p) => p.ref.endsWith("#2"))).toEqual([]);
  expect(orphanPrs([pr(3, { level: "ready", text: "" }, {}, "merged")], none)).toEqual([]);
});

test("The number, its state as level and hover word, the most urgent first", () => {
  const r = orphanPrs([pr(4, { level: "review", text: "" }, { mine: false, author: "anna" }), pr(5, { level: "ready", text: "" }), pr(6, { level: "fail", text: "" })], none);
  expect(r.map((p) => p.label)).toEqual(["#6", "#5", "#4"]);
  expect(r.map((p) => p.level)).toEqual(["fail", "ready", "review"]);
  expect(r.map((p) => p.hint)).toEqual(["CI failing · PR 6", "ready to merge · PR 5", "Review · anna · PR 4"]);
  expect(r[0]).toMatchObject({ mine: true, url: "https://github.com/acme/shop/pull/6" });
  expect(r[2]?.mine).toBe(false);
});

test("A session with several PRs shows its open ones, most urgent first, then newest; a merged one only when nothing is open", () => {
  const merged = (n: number) => pr(n, null, {}, "merged");
  const open = (n: number) => pr(n, null, {}, "mergeable");
  expect(sessionPrs([merged(408), open(415), merged(409)]).map((p) => p.ref)).toEqual(["pr:github/acme/shop#415"]);
  expect(sessionPrs([open(410), merged(411), open(412)]).map((p) => p.ref)).toEqual(["pr:github/acme/shop#412", "pr:github/acme/shop#410"]);
  const urgent = sessionPrs([open(420), pr(111, { level: "fail", text: "" }, {}, "blocked"), pr(415, { level: "ready", text: "" }, {}, "mergeable")]);
  expect(urgent.map((p) => p.data.number)).toEqual([111, 415, 420]); // most urgent on top, not the newest
  expect(sessionPrs([merged(408), merged(409)]).map((p) => p.ref)).toEqual(["pr:github/acme/shop#409"]);
  expect(sessionPr([])).toBeNull();
});
