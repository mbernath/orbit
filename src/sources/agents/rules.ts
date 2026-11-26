// Agent triggers as fixed rules (ADR-0016, ADR-0020): validated, matched against domain events, scheduled, and shown
// back in plain words. Pure code — matching never calls an LLM.
import type { DomainEvent, DomainEventType } from "../../core/types";

export const EVENT_TYPES: DomainEventType[] = ["pr.opened", "pr.merged", "ci.failed", "session.done", "file.changed"];

export type Schedule =
  | { every: "day" | "weekday"; at: string }
  | { every: "week"; at: string; weekday: number } // 1 = Monday … 7 = Sunday
  | { every: "hours"; hours: number };

export type Rule =
  | { kind: "manual" }
  | { kind: "event"; type: DomainEventType; repo?: string; branch?: string; path?: string }
  | { kind: "schedule"; schedule: Schedule };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The rule if it fits the schema exactly, else null (an LLM answer is never trusted as is). */
export function parseRule(x: unknown): Rule | null {
  const r = x as Record<string, any>;
  if (!r || typeof r !== "object") return null;
  if (r.kind === "manual") return { kind: "manual" };
  if (r.kind === "event") {
    if (!EVENT_TYPES.includes(r.type)) return null;
    const rule: Rule = { kind: "event", type: r.type };
    for (const k of ["repo", "branch", "path"] as const) {
      if (r[k] == null || r[k] === "") continue;
      if (typeof r[k] !== "string") return null;
      rule[k] = r[k];
    }
    return rule;
  }
  if (r.kind === "schedule") {
    const s = r.schedule ?? {};
    if ((s.every === "day" || s.every === "weekday") && TIME.test(s.at)) return { kind: "schedule", schedule: { every: s.every, at: s.at } };
    if (s.every === "week" && TIME.test(s.at) && Number.isInteger(s.weekday) && s.weekday >= 1 && s.weekday <= 7)
      return { kind: "schedule", schedule: { every: "week", at: s.at, weekday: s.weekday } };
    if (s.every === "hours" && Number.isInteger(s.hours) && s.hours >= 1 && s.hours <= 168) return { kind: "schedule", schedule: { every: "hours", hours: s.hours } };
  }
  return null;
}

/** "*" matches any run of characters except "/", "**" any run including "/". */
function glob(pattern: string, value: string) {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value);
}

/**
 * Whether an event fires a rule. Events are limited to the agent's workspace when they carry one, and file events to
 * files inside the agent's folder.
 */
export function matches(rule: Rule, e: DomainEvent, scope: { workspaceId: string; folder: string }): boolean {
  if (rule.kind !== "event" || rule.type !== e.type) return false;
  if ("workspaceId" in e && e.workspaceId && e.workspaceId !== scope.workspaceId) return false;
  if ("repo" in e && rule.repo && rule.repo !== e.repo) return false;
  // "after every merge into main" means the target branch; for other PR events the PR's own branch
  const branch = e.type === "pr.merged" ? e.base : "branch" in e ? e.branch : null;
  if (rule.branch && (!branch || !glob(rule.branch, branch))) return false;
  if (e.type === "file.changed") {
    if (!e.path.startsWith(scope.folder + "/")) return false;
    if (rule.path && !glob(rule.path, e.path.slice(scope.folder.length + 1))) return false;
  }
  if (e.type === "session.done" && (!e.cwd || !(e.cwd === scope.folder || e.cwd.startsWith(scope.folder + "/")))) return false;
  return true;
}

const at = (d: Date, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const x = new Date(d);
  x.setHours(h as number, m as number, 0, 0);
  return x;
};
const isoWeekday = (d: Date) => ((d.getDay() + 6) % 7) + 1;

/** Next time a schedule is due after `from` (local time). A run missed while Orbit was off is due once, at once. */
export function nextDue(s: Schedule, from: number): number {
  if (s.every === "hours") return from + s.hours * 3600_000;
  const start = new Date(from);
  for (let day = 0; day <= 8; day++) {
    const d = new Date(start);
    d.setDate(start.getDate() + day);
    const t = at(d, s.at);
    if (t.getTime() <= from) continue;
    const wd = isoWeekday(t);
    if (s.every === "weekday" && wd > 5) continue;
    if (s.every === "week" && wd !== s.weekday) continue;
    return t.getTime();
  }
  return from + 7 * 86400_000; // unreachable for valid schedules
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EVENT_TEXT: Record<DomainEventType, string> = {
  "pr.opened": "on every new PR",
  "pr.merged": "after every merge",
  "ci.failed": "when CI fails",
  "session.done": "when a session is done",
  "file.changed": "when a file changes",
};

/** The rule read back, e.g. "Runs: after every merge into main". */
export function describeRule(rule: Rule | null): string {
  if (!rule || rule.kind === "manual") return rule ? "Runs only when you start it." : "Trigger not understood: runs only when you start it.";
  if (rule.kind === "schedule") {
    const s = rule.schedule;
    if (s.every === "hours") return `Runs: every ${s.hours === 1 ? "hour" : `${s.hours} hours`}`;
    if (s.every === "day") return `Runs: daily at ${s.at}`;
    if (s.every === "weekday") return `Runs: weekdays at ${s.at}`;
    if (s.every === "week") return `Runs: every ${WEEKDAYS[s.weekday - 1]} at ${s.at}`;
    return `Runs: daily at ${s.at}`;
  }
  const parts = [EVENT_TEXT[rule.type]];
  if (rule.branch) parts.push(rule.type === "pr.merged" ? `into ${rule.branch}` : `on ${rule.branch}`);
  if (rule.repo) parts.push(`(${rule.repo})`);
  if (rule.path) parts.push(`under ${rule.path}`);
  return `Runs: ${parts.join(" ")}`;
}

/** What a run is told about why it started. */
export function eventText(e: DomainEvent): string {
  switch (e.type) {
    case "pr.opened":
      return `New PR #${e.number} “${e.title}” in ${e.repo} (branch ${e.branch}).`;
    case "pr.merged":
      return `PR #${e.number} in ${e.repo} was merged (${e.branch} → ${e.base ?? "?"}).`;
    case "ci.failed":
      return `CI is failing on PR #${e.number} in ${e.repo} (branch ${e.branch}).`;
    case "session.done":
      return `Session ${e.sessionId} is done${e.cwd ? ` (folder ${e.cwd})` : ""}.`;
    case "file.changed":
      return `The file ${e.path} changed.`;
  }
}
