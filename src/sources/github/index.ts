// GitHub source (ADR-0006): repos in workspaces, their open pull requests, and recently merged ones (ADR-0023).
// Entities: `repo:github/<owner/name>@<workspace>` (panel in the lane head) and `pr:github/<owner/name>#<n>`.
import type { ActionDefinition, CoreContext, Entity, Source } from "../../core/types";
import { diffPrs } from "./events";
import { createGhClient, type MergeMethod, type PullRequest, type RepoState } from "./gh";

/** merged PRs stay on the board this long (ADR-0023) */
const MERGED_KEEP_MS = 14 * 86400_000;

export function createGitHubSource(opts: { intervalMs?: number } = {}): Source & { refresh(): Promise<void> } {
  let ctx: CoreContext;
  let gh: ReturnType<typeof createGhClient>;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** the previous refresh, to derive domain events (ADR-0020); null until the first one */
  let previous: RepoState[] | null = null;

  const refresh = async () => {
    try {
      await gh.refresh(ctx.workspaces.list());
      const now = gh.repos();
      const { events, vanished } = diffPrs(previous, now);
      previous = now;
      for (const e of events) ctx.publish(e);
      for (const v of vanished) {
        const m = await gh.mergedInto(v.repo, v.number);
        if (!m?.merged) continue;
        rememberMerged({ ...v, base: m.base });
        ctx.publish({ type: "pr.merged", repo: v.repo, number: v.number, branch: v.branch, base: m.base, workspaceId: v.workspaceId });
      }
      ctx.db.run(`DELETE FROM github_merged WHERE merged_at < ?`, [Date.now() - MERGED_KEEP_MS]);
    } catch (err) {
      console.error("GitHub refresh failed:", err);
    }
    ctx.emit();
  };

  // ---------- Merged PRs stay visible for a while (ADR-0023) ----------
  type Merged = { repo: string; number: number; title: string; url: string; branch: string; base: string | null; dir: string; workspaceId: string };
  function rememberMerged(m: Merged) {
    ctx.db.run(
      `INSERT INTO github_merged (repo, number, title, url, branch, base, dir, workspace_id, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO NOTHING`,
      [m.repo, m.number, m.title, m.url, m.branch, m.base, m.dir, m.workspaceId, Date.now()],
    );
  }
  const mergedEntities = (): Entity[] => {
    const open = new Set(gh.repos().flatMap((r) => r.prs.map((p) => `${r.dir}#${p.branch}`)));
    const rows = ctx.db.query(`SELECT * FROM github_merged ORDER BY merged_at DESC`).all() as
      { repo: string; number: number; title: string; url: string; branch: string; base: string | null; dir: string; workspace_id: string; merged_at: number }[];
    return rows
      .filter((m) => !open.has(`${m.dir}#${m.branch}`)) // an open PR on the same branch wins
      .map((m) => ({
        ref: `pr:github/${m.repo}#${m.number}`,
        kind: "pr",
        source: "github",
        title: m.title,
        status: "merged",
        workspaceId: m.workspace_id,
        paths: [m.dir],
        keys: [`git:${m.dir}#${m.branch}`],
        attention: null,
        parent: null,
        updatedAt: m.merged_at,
        actions: [],
        data: { repo: m.repo, number: m.number, url: m.url, branch: m.branch, base: m.base, mergedAt: m.merged_at, merged: true },
      }));
  };

  const repoEntity = (r: RepoState): Entity => ({
    ref: `repo:github/${r.repo}@${r.workspaceId}`,
    kind: "repo",
    source: "github",
    title: r.repo,
    status: r.error ? "error" : "ok",
    workspaceId: r.workspaceId,
    paths: [r.dir],
    keys: [],
    attention: null,
    parent: null,
    updatedAt: r.fetchedAt ?? 0,
    actions: [],
    data: { repo: r.repo, dir: r.dir, error: r.error, prs: r.prs.map((p) => `pr:github/${r.repo}#${p.number}`) },
  });

  // own PRs: red CI or mergeable; someone else's only when the user's review is requested (ADR-0038)
  const prAttention = (p: PullRequest): Entity["attention"] =>
    !p.mine ? (p.reviewRequested ? { level: "review", text: "Review requested" } : null)
    : p.ci === "fail" ? { level: "fail", text: "CI failing" } : p.mergeable ? { level: "ready", text: "ready to merge" } : null;

  const prEntities = (r: RepoState): Entity[] =>
    r.prs.map((p) => ({
      ref: `pr:github/${r.repo}#${p.number}`,
      kind: "pr",
      source: "github",
      title: p.title,
      status: p.mergeable ? "mergeable" : "blocked",
      workspaceId: r.workspaceId,
      paths: [r.dir],
      // Shared with sessions working on the same branch of the same repo (ADR-0008 related entities).
      keys: [`git:${r.dir}#${p.branch}`],
      attention: prAttention(p),
      parent: `repo:github/${r.repo}@${r.workspaceId}`,
      updatedAt: r.fetchedAt ?? 0,
      actions: p.mergeable ? ["github.merge"] : [],
      data: { ...p, repo: r.repo, mergeMethods: r.mergeMethods },
    }));

  const actions: ActionDefinition[] = [
    {
      id: "github.refresh",
      risk: "local", // reads only
      allowedActors: ["board"],
      async run() {
        await refresh();
        return { ok: true };
      },
    },
    {
      id: "github.merge",
      risk: "irreversible",
      allowedActors: ["board"],
      validate: (i: { repo?: unknown; number?: unknown }) =>
        typeof i?.repo === "string" && Number.isInteger(i.number) ? null : "PR missing.",
      async run(i: { repo: string; number: number; method?: MergeMethod; deleteBranch?: boolean; subject?: string }) {
        // Only PRs currently shown as mergeable, with a method the repo allows.
        const repo = gh.repos().find((r) => r.repo === i.repo);
        const pr = repo?.prs.find((p) => p.number === i.number);
        if (!repo || !pr) return { ok: false, status: 404, error: "PR not found." };
        if (!pr.mergeable) return { ok: false, status: 409, error: `Not ready to merge: ${pr.blockedReason}` };
        if (!i.method || !repo.mergeMethods.includes(i.method))
          return { ok: false, status: 400, error: "This repository doesn't allow that merge method." };
        const r = await gh.merge(repo.repo, pr.number, i.method, i.deleteBranch !== false, i.subject?.trim() || undefined);
        if (!r.ok) return { ok: false, status: 502, error: r.error };
        // remembered at once, not only when the next refresh notices it is gone (ADR-0023)
        rememberMerged({ repo: repo.repo, number: pr.number, title: pr.title, url: pr.url, branch: pr.branch, base: null, dir: repo.dir, workspaceId: repo.workspaceId });
        await refresh();
        return { ok: true };
      },
    },
  ];

  return {
    id: "github",
    migrations: [
      {
        version: 1, // merged PRs (ADR-0023)
        up: (db) =>
          db.exec(`CREATE TABLE github_merged (
            repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, branch TEXT NOT NULL,
            base TEXT, dir TEXT NOT NULL, workspace_id TEXT NOT NULL, merged_at INTEGER NOT NULL, PRIMARY KEY (repo, number))`),
      },
    ],
    actions,
    refresh,
    start(c) {
      ctx = c;
      gh = createGhClient({ run: c.run, neutralCwd: c.home });
      c.on((e) => {
        if (e.type === "workspaces.changed") void refresh();
      });
      void refresh();
      const interval = opts.intervalMs ?? 60_000;
      if (interval > 0) timer = setInterval(refresh, interval);
    },
    entities: () => (gh ? [...gh.repos().flatMap((r) => [repoEntity(r), ...prEntities(r)]), ...mergedEntities()] : []),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
