// ADR-0016/0020: trigger rules are validated, matched and scheduled by plain code.
import { expect, test } from "bun:test";
import type { DomainEvent } from "../src/core/types";
import { describeRule, matches, nextDue, parseRule } from "../src/sources/agents/rules";

const scope = { workspaceId: "acme", folder: "/work/shop" };
const merged = (base: string, workspaceId = "acme"): DomainEvent => ({ type: "pr.merged", repo: "acme/shop", number: 7, branch: "feat/x", base, workspaceId });

test("Only rules that fit the schema exactly are accepted", () => {
  expect(parseRule({ kind: "event", type: "pr.merged", branch: "main" })).toEqual({ kind: "event", type: "pr.merged", branch: "main" });
  expect(parseRule({ kind: "event", type: "pr.deleted" })).toBeNull();
  expect(parseRule({ kind: "schedule", schedule: { every: "day", at: "9:00" } })).toBeNull();
  expect(parseRule({ kind: "schedule", schedule: { every: "week", at: "08:30", weekday: 1 } })).toEqual({ kind: "schedule", schedule: { every: "week", at: "08:30", weekday: 1 } });
  expect(parseRule({ kind: "schedule", schedule: { every: "hours", hours: 0 } })).toBeNull();
  expect(parseRule("whatever")).toBeNull();
});

test("Events: merge into main, only in the agent's own island, files only in its own folder", () => {
  const rule = parseRule({ kind: "event", type: "pr.merged", branch: "main" })!;
  expect(matches(rule, merged("main"), scope)).toBe(true);
  expect(matches(rule, merged("develop"), scope)).toBe(false);
  expect(matches(rule, merged("main", "other"), scope)).toBe(false);
  expect(matches(rule, { type: "pr.opened", repo: "acme/shop", number: 1, branch: "main", title: "x", workspaceId: "acme" }, scope)).toBe(false);

  const docs = parseRule({ kind: "event", type: "file.changed", path: "docs/**" })!;
  expect(matches(docs, { type: "file.changed", path: "/work/shop/docs/a/roadmap.md" }, scope)).toBe(true);
  expect(matches(docs, { type: "file.changed", path: "/work/shop/README.md" }, scope)).toBe(false);
  expect(matches(docs, { type: "file.changed", path: "/work/other/docs/x.md" }, scope)).toBe(false);

  const feat = parseRule({ kind: "event", type: "ci.failed", branch: "feat/*" })!;
  expect(matches(feat, { type: "ci.failed", repo: "acme/shop", number: 2, branch: "feat/login", workspaceId: "acme" }, scope)).toBe(true);
  expect(matches(feat, { type: "ci.failed", repo: "acme/shop", number: 2, branch: "fix/login", workspaceId: "acme" }, scope)).toBe(false);
});

test("Schedules: next date in local time; weekdays skip the weekend", () => {
  const fri = new Date(2026, 10, 20, 10, 0).getTime(); // Friday 20 Nov 2026, 10:00
  expect(new Date(nextDue({ every: "day", at: "09:00" }, fri))).toEqual(new Date(2026, 10, 21, 9, 0));
  expect(new Date(nextDue({ every: "day", at: "11:30" }, fri))).toEqual(new Date(2026, 10, 20, 11, 30));
  expect(new Date(nextDue({ every: "weekday", at: "09:00" }, fri))).toEqual(new Date(2026, 10, 23, 9, 0)); // Monday
  expect(new Date(nextDue({ every: "week", at: "08:00", weekday: 3 }, fri))).toEqual(new Date(2026, 10, 25, 8, 0)); // Wednesday
  expect(nextDue({ every: "hours", hours: 6 }, fri)).toBe(fri + 6 * 3600_000);
});

test("Rules are read back in plain English", () => {
  expect(describeRule(parseRule({ kind: "event", type: "pr.merged", branch: "main" }))).toBe("Runs: after every merge into main");
  expect(describeRule(parseRule({ kind: "schedule", schedule: { every: "weekday", at: "09:00" } }))).toBe("Runs: weekdays at 09:00");
  expect(describeRule(parseRule({ kind: "schedule", schedule: { every: "week", at: "08:00", weekday: 1 } }))).toBe("Runs: every Monday at 08:00");
  expect(describeRule({ kind: "manual" })).toBe("Runs only when you start it.");
  expect(describeRule(null)).toBe("Trigger not understood: runs only when you start it.");
});
