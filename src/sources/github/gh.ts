// GitHub integration through the user's own `gh` CLI (ADR-0006).
// Repos are discovered in workspace folders; pull requests are polled and cached server-side.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Runner, RunResult } from "../../core/types";
import { expandHome } from "../../core/util";

export type MergeMethod = "squash" | "merge" | "rebase";

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string | null;
  isDraft: boolean;
  ci: "pass" | "fail" | "pending" | "none";
  mergeable: boolean;
  blockedReason: string | null; // shown in the board as is
  needsAttention: boolean;
  // ADR-0038: authored by the viewer (true when the viewer is unknown), and whether his review is requested
  mine: boolean;
  reviewRequested: boolean;
};

export type RepoState = {
  workspaceId: string;
  dir: string;
  repo: string; // owner/name
  prs: PullRequest[];
  mergeMethods: MergeMethod[];
  error: string | null;
  fetchedAt: number | null;
};

const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target"]);

// The workspace folder itself plus two levels below, for folders holding several repos.
export function findGitDirs(root: string, depth = 2): string[] {
  const dir = expandHome(root);
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, ".git"))) return [dir];
  if (depth === 0) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
    .flatMap((e) => findGitDirs(join(dir, e.name), depth - 1));
}

export function parseGitHubRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

export function ciState(rollup: any[] | null | undefined): PullRequest["ci"] {
  if (!rollup?.length) return "none";
  let pending = false;
  for (const c of rollup) {
    const result = c.conclusion || c.state; // CheckRun has conclusion, StatusContext has state
    if (FAILED.has(result)) return "fail";
    if ((c.status && c.status !== "COMPLETED") || result === "PENDING" || result === "EXPECTED") pending = true;
  }
  return pending ? "pending" : "pass";
}

export function summarizePr(raw: any, viewer: string | null = null): PullRequest {
  const ci = ciState(raw.statusCheckRollup);
  const state = raw.mergeStateStatus as string | undefined;
  const mergeable = !raw.isDraft && (state === "CLEAN" || state === "HAS_HOOKS");
  let blockedReason: string | null = null;
  if (!mergeable) {
    if (raw.isDraft) blockedReason = "Draft";
    else if (raw.mergeable === "CONFLICTING" || state === "DIRTY") blockedReason = "Merge conflicts";
    else if (state === "BEHIND") blockedReason = "Branch out of date";
    else if (raw.reviewDecision === "CHANGES_REQUESTED") blockedReason = "Changes requested";
    else if (ci === "fail" || state === "UNSTABLE") blockedReason = "Checks failed"; // not "CI failing": the CI label beside it already says that
    else if (ci === "pending") blockedReason = "CI running";
    else if (raw.reviewDecision === "REVIEW_REQUIRED") blockedReason = "Review required";
    else if (state === "UNKNOWN" || !state) blockedReason = "Checking mergeability";
    else blockedReason = "Blocked";
  }
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    branch: raw.headRefName,
    author: raw.author?.login ?? null,
    isDraft: !!raw.isDraft,
    ci,
    mergeable,
    blockedReason,
    needsAttention: ci === "fail" || mergeable,
    mine: !viewer || raw.author?.login === viewer,
    reviewRequested: !!viewer && (raw.reviewRequests ?? []).some((r: any) => r?.login === viewer),
  };
}

const PR_FIELDS =
  "number,title,url,headRefName,author,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviewRequests";

const ghError = (r: RunResult) => {
  const msg = r.stderr.trim() || r.stdout.trim();
  if (r.code === 127 || /not found|ENOENT/i.test(msg)) return "GitHub CLI (gh) not found.";
  if (/auth|login/i.test(msg)) return "gh is not logged in (gh auth login).";
  return msg.split("\n")[0] || `gh fehlgeschlagen (Code ${r.code}).`;
};

export function createGhClient(opts: { run: Runner; neutralCwd: string }) {
  const { run } = opts;
  const remotes = new Map<string, string | null>(); // dir -> owner/name
  const repoInfo = new Map<string, { methods: MergeMethod[] }>();
  let repos: RepoState[] = [];
  let refreshing: Promise<void> | null = null;
  let viewer: string | null | undefined; // the gh login, asked once (ADR-0038); null when gh cannot tell

  async function viewerLogin() {
    if (viewer === undefined) {
      const r = await run(["gh", "api", "user", "--jq", ".login"], opts.neutralCwd);
      viewer = r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    }
    return viewer;
  }

  async function resolveRepo(dir: string) {
    if (!remotes.has(dir)) {
      const r = await run(["git", "-C", dir, "remote", "get-url", "origin"]);
      remotes.set(dir, r.code === 0 ? parseGitHubRemote(r.stdout) : null);
    }
    return remotes.get(dir) ?? null;
  }

  async function mergeMethods(repo: string): Promise<MergeMethod[]> {
    const cached = repoInfo.get(repo);
    if (cached) return cached.methods;
    const r = await run(["gh", "repo", "view", repo, "--json", "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed"], opts.neutralCwd);
    if (r.code !== 0) return ["squash", "merge", "rebase"];
    const j = JSON.parse(r.stdout);
    const methods: MergeMethod[] = [];
    if (j.squashMergeAllowed) methods.push("squash");
    if (j.mergeCommitAllowed) methods.push("merge");
    if (j.rebaseMergeAllowed) methods.push("rebase");
    repoInfo.set(repo, { methods });
    return methods;
  }

  async function fetchRepo(base: Omit<RepoState, "prs" | "mergeMethods" | "error" | "fetchedAt">): Promise<RepoState> {
    const r = await run(
      ["gh", "pr", "list", "--repo", base.repo, "--state", "open", "--limit", "30", "--json", PR_FIELDS],
      opts.neutralCwd,
    );
    if (r.code !== 0) return { ...base, prs: [], mergeMethods: [], error: ghError(r), fetchedAt: Date.now() };
    let prs: PullRequest[] = [];
    const me = await viewerLogin();
    try {
      prs = (JSON.parse(r.stdout) as any[]).map((raw) => summarizePr(raw, me));
    } catch {
      return { ...base, prs: [], mergeMethods: [], error: "Couldn't read the answer from gh.", fetchedAt: Date.now() };
    }
    return { ...base, prs, mergeMethods: await mergeMethods(base.repo), error: null, fetchedAt: Date.now() };
  }

  async function doRefresh(workspaces: { id: string; paths: string[] }[]) {
    const found: { workspaceId: string; dir: string; repo: string }[] = [];
    const seen = new Set<string>();
    for (const ws of workspaces) {
      for (const p of ws.paths) {
        for (const dir of findGitDirs(p)) {
          const repo = await resolveRepo(dir);
          const key = `${ws.id}|${repo}`;
          if (repo && !seen.has(key)) {
            seen.add(key);
            found.push({ workspaceId: ws.id, dir, repo });
          }
        }
      }
    }
    repos = await Promise.all(found.map(fetchRepo));
  }

  return {
    repos: () => repos,
    /** Whether a PR that left the open list was merged, and into which branch; null when gh cannot tell. */
    async mergedInto(repo: string, number: number): Promise<{ merged: boolean; base: string | null } | null> {
      const r = await run(["gh", "pr", "view", String(number), "--repo", repo, "--json", "state,baseRefName"], opts.neutralCwd);
      if (r.code !== 0) return null;
      try {
        const j = JSON.parse(r.stdout);
        return { merged: j.state === "MERGED", base: j.baseRefName ?? null };
      } catch {
        return null;
      }
    },
    // Concurrent callers share one run.
    refresh(workspaces: { id: string; paths: string[] }[]) {
      refreshing ??= doRefresh(workspaces).finally(() => (refreshing = null));
      return refreshing;
    },
    async merge(repo: string, number: number, method: MergeMethod, deleteBranch: boolean, subject?: string) {
      // --repo plus a neutral cwd: gh must not touch any local checkout or worktree.
      const cmd = ["gh", "pr", "merge", String(number), "--repo", repo, `--${method}`];
      if (deleteBranch) cmd.push("--delete-branch");
      if (subject && method !== "rebase") cmd.push("--subject", subject);
      const r = await run(cmd, opts.neutralCwd);
      return r.code === 0 ? { ok: true as const } : { ok: false as const, error: ghError(r) };
    },
  };
}
