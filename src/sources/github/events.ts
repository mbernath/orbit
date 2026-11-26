// Domain events from two consecutive PR refreshes (ADR-0020): a new PR, CI turning red, and PRs that are no longer
// open (the caller asks gh whether they were merged). Pure, so it is tested without gh.
import type { DomainEvent } from "../../core/types";
import type { RepoState } from "./gh";

export type Vanished = { repo: string; number: number; branch: string; workspaceId: string; title: string; url: string; dir: string };

/**
 * @param before the previous refresh; null on the first one (a baseline: nothing is "new" yet)
 * Repos that failed in either refresh are skipped, so an outage never reads as "all PRs closed".
 */
export function diffPrs(before: RepoState[] | null, after: RepoState[]): { events: DomainEvent[]; vanished: Vanished[] } {
  const events: DomainEvent[] = [];
  const vanished: Vanished[] = [];
  if (!before) return { events, vanished };
  const key = (r: RepoState) => `${r.workspaceId}|${r.repo}`;
  const prev = new Map(before.filter((r) => !r.error).map((r) => [key(r), r]));
  for (const r of after) {
    const old = prev.get(key(r));
    if (r.error || !old) continue; // new repo: baseline too
    const oldPrs = new Map(old.prs.map((p) => [p.number, p]));
    const base = { repo: r.repo, workspaceId: r.workspaceId };
    for (const p of r.prs) {
      const o = oldPrs.get(p.number);
      if (!o) events.push({ type: "pr.opened", ...base, number: p.number, branch: p.branch, title: p.title });
      else if (p.ci === "fail" && o.ci !== "fail") events.push({ type: "ci.failed", ...base, number: p.number, branch: p.branch });
    }
    const open = new Set(r.prs.map((p) => p.number));
    for (const o of old.prs) if (!open.has(o.number)) vanished.push({ ...base, number: o.number, branch: o.branch, title: o.title, url: o.url, dir: r.dir });
  }
  return { events, vanished };
}
