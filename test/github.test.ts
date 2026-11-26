import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/core/types";
import { createOrbit } from "../src/server";
import { ciState, findGitDirs, parseGitHubRemote, summarizePr } from "../src/sources/github/gh";
import { BOARD_TOKEN, client } from "./helpers";

test("A GitHub remote is recognised", () => {
  expect(parseGitHubRemote("git@github.com:mbernath/orbit.git\n")).toBe("mbernath/orbit");
  expect(parseGitHubRemote("https://github.com/acme/widgets")).toBe("acme/widgets");
  expect(parseGitHubRemote("https://gitlab.com/a/b.git")).toBe(null);
});

test("CI state from statusCheckRollup", () => {
  expect(ciState([])).toBe("none");
  expect(ciState([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }])).toBe("pass");
  expect(ciState([{ status: "IN_PROGRESS", conclusion: "" }, { status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("pending");
  expect(ciState([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }])).toBe("fail");
  expect(ciState([{ state: "ERROR" }])).toBe("fail");
});

test("Mergeability and reason", () => {
  const base = { number: 1, title: "t", url: "u", headRefName: "b", isDraft: false };
  const pass = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
  expect(summarizePr({ ...base, mergeStateStatus: "CLEAN", statusCheckRollup: pass })).toMatchObject({ mergeable: true, needsAttention: true, blockedReason: null });
  expect(summarizePr({ ...base, isDraft: true, mergeStateStatus: "CLEAN" }).blockedReason).toBe("Draft");
  expect(summarizePr({ ...base, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }).blockedReason).toBe("Merge conflicts");
  expect(summarizePr({ ...base, mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: pass }).blockedReason).toBe("Review required");
  const red = summarizePr({ ...base, mergeStateStatus: "BLOCKED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] });
  expect(red).toMatchObject({ ci: "fail", mergeable: false, needsAttention: true, blockedReason: "Checks failed" });
  expect(summarizePr({ ...base, mergeStateStatus: "BLOCKED", statusCheckRollup: [{ status: "QUEUED" }] }).needsAttention).toBe(false);
});

// ---------- Server with a stubbed gh ----------

const home = mkdtempSync(join(tmpdir(), "orbit-gh-"));
const repoDir = join(home, "work", "shop");
const port = 48000 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const calls: string[][] = [];
let mergeFails = false;
const merged = new Set<number>(); // PRs merged through the stub: gone from the open list, "MERGED" in gh pr view
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(base, () => orbit.hookToken);

const prs = () => [
  { number: 7, title: "Cart", url: "https://github.com/acme/shop/pull/7", headRefName: "feature/cart", author: { login: "alex" },
    isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
  { number: 8, title: "Broken", url: "https://github.com/acme/shop/pull/8", headRefName: "fix/broken", author: { login: "alex" },
    isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", reviewDecision: null,
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }] },
  // someone else's PR asking for the user's review, with red CI that is not theirs to fix (ADR-0038)
  { number: 9, title: "Someone else's", url: "https://github.com/acme/shop/pull/9", headRefName: "anna/x", author: { login: "anna" },
    isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }], reviewRequests: [{ login: "alex" }] },
];

const run: Runner = async (cmd, cwd) => {
  calls.push(cwd ? [...cmd, `@${cwd}`] : cmd);
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  if (cmd[0] === "git" && cmd.includes("get-url")) return ok("git@github.com:acme/shop.git\n");
  if (cmd[1] === "api" && cmd[2] === "user") return ok("alex\n");
  if (cmd[1] === "pr" && cmd[2] === "list") return ok(JSON.stringify(prs().filter((p) => !merged.has(p.number))));
  if (cmd[1] === "pr" && cmd[2] === "view") return ok(JSON.stringify({ state: merged.has(Number(cmd[3])) ? "MERGED" : "OPEN", baseRefName: "main" }));
  if (cmd[1] === "repo" && cmd[2] === "view") return ok(JSON.stringify({ squashMergeAllowed: true, mergeCommitAllowed: false, rebaseMergeAllowed: true }));
  if (cmd[1] === "pr" && cmd[2] === "merge") return mergeFails ? { code: 1, stdout: "", stderr: "Pull request is not mergeable" } : (merged.add(Number(cmd[3])), ok(""));
  return { code: 1, stdout: "", stderr: "unexpected" };
};

beforeAll(async () => {
  mkdirSync(join(repoDir, ".git"), { recursive: true });
  mkdirSync(join(home, "work", "notes"), { recursive: true }); // no repo, must be ignored
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [join(home, "work")] }]));
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), run, githubIntervalMs: 0, boardToken: BOARD_TOKEN });
  await orbit.refreshGitHub();
});
afterAll(() => orbit.stop());

test("Repos are found in the workspace, also one level down", () => {
  expect(findGitDirs(join(home, "work"))).toEqual([repoDir]);
});

test("Repo and PR entities; a session is linked to its PR through shared keys", async () => {
  await c.hook(
    { session_id: "s1", hook_event_name: "SessionStart", cwd: "/elsewhere/worktree" },
    { "X-Orbit-Git-Common": join(repoDir, ".git"), "X-Orbit-Branch": "feature/cart" },
  );
  const st = await c.state();
  const repo = st.entities.find((e) => e.kind === "repo")!;
  expect(repo).toMatchObject({ ref: "repo:github/acme/shop@acme", workspaceId: "acme" });
  expect(repo.data).toMatchObject({ error: null, prs: ["pr:github/acme/shop#7", "pr:github/acme/shop#8", "pr:github/acme/shop#9"] });

  const pr7 = st.entities.find((e) => e.ref === "pr:github/acme/shop#7")!;
  const pr8 = st.entities.find((e) => e.ref === "pr:github/acme/shop#8")!;
  expect(pr7).toMatchObject({ status: "mergeable", attention: { level: "ready" }, actions: ["github.merge"] });
  expect(pr7.data).toMatchObject({ ci: "pass", mergeMethods: ["squash", "rebase"] });
  expect(pr8).toMatchObject({ status: "blocked", attention: { level: "fail" }, actions: [] });
  const pr9 = st.entities.find((e) => e.ref === "pr:github/acme/shop#9")!;
  expect(pr9).toMatchObject({ attention: { level: "review", text: "Review requested" } });
  expect(pr9.data).toMatchObject({ mine: false, reviewRequested: true });
  expect(pr8.data).toMatchObject({ mine: true, reviewRequested: false });

  const session = st.entities.find((e) => e.ref === "session:claude/s1")!;
  expect(session.related).toEqual(["pr:github/acme/shop#7"]);
  expect(pr7.related).toEqual(["session:claude/s1"]);
});

test("Merge: only confirmed, only mergeable PRs, only allowed methods, gh without a local checkout", async () => {
  const merge = (input: object, confirm = true) => c.action("github.merge", input, confirm);
  expect((await merge({ repo: "acme/shop", number: 7, method: "squash" }, false)).status).toBe(428);
  expect((await merge({ repo: "acme/shop", number: 8, method: "squash" })).status).toBe(409);
  expect((await merge({ repo: "acme/shop", number: 7, method: "merge" })).status).toBe(400);
  expect((await merge({ repo: "acme/shop", number: 99, method: "squash" })).status).toBe(404);

  mergeFails = true;
  const failed = await merge({ repo: "acme/shop", number: 7, method: "squash", deleteBranch: true });
  expect(failed.status).toBe(502);
  expect(((await failed.json()) as any).error).toBe("Pull request is not mergeable");
  mergeFails = false;

  const res = await merge({ repo: "acme/shop", number: 7, method: "squash", deleteBranch: true, subject: "Cart (#7)" });
  expect(res.status).toBe(200);
  const call = calls.filter((c) => c[2] === "merge").at(-1)!;
  expect(call).toEqual(["gh", "pr", "merge", "7", "--repo", "acme/shop", "--squash", "--delete-branch", "--subject", "Cart (#7)", `@${home}`]);
});

test("After the merge the PR stays at its session as merged (ADR-0023)", async () => {
  const pr7 = await c.entity("pr:github/acme/shop#7");
  expect(pr7).toMatchObject({ status: "merged", attention: null, actions: [] });
  expect(pr7?.data).toMatchObject({ merged: true, url: "https://github.com/acme/shop/pull/7", branch: "feature/cart" });
  expect((await c.session("s1"))?.related).toEqual(["pr:github/acme/shop#7"]);
  // a later refresh notices it is gone, asks gh, and keeps one record (no duplicate)
  await orbit.refreshGitHub();
  expect((await c.state()).entities.filter((e) => e.ref === "pr:github/acme/shop#7")).toHaveLength(1);
  const ev = orbit.db.query(`SELECT payload FROM event_log WHERE type = 'event.pr.merged'`).get() as { payload: string };
  expect(JSON.parse(ev.payload)).toMatchObject({ number: 7, base: "main" });
});

test("Shared main checkout: only the session that created the branch gets the PR (ADR-0024)", async () => {
  const bash = (command: string, gitBranch: string) =>
    JSON.stringify({ type: "assistant", gitBranch, message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } });
  const author = join(home, "author.jsonl"), bystander = join(home, "bystander.jsonl");
  writeFileSync(author, bash("git checkout -b fix/broken origin/main", "main") + "\n");
  writeFileSync(bystander, bash("bun test", "fix/broken") + "\n");
  const head = { "X-Orbit-Git-Common": join(repoDir, ".git"), "X-Orbit-Branch": "fix/broken", "X-Orbit-Git-Top": repoDir };
  for (const [id, t] of [["author", author], ["bystander", bystander]] as const) {
    await c.hook({ session_id: id, hook_event_name: "SessionStart", cwd: repoDir, transcript_path: t }, head);
    await c.hook({ session_id: id, hook_event_name: "Stop", cwd: repoDir, transcript_path: t, last_assistant_message: "ok" }, head);
  }
  const pr8 = await c.entity("pr:github/acme/shop#8");
  expect(pr8?.related).toContain("session:claude/author");
  expect(pr8?.related).not.toContain("session:claude/bystander");
});

test("A pushed branch links its session at the Bash step, without waiting for Stop (ADR-0024)", async () => {
  const head = { "X-Orbit-Git-Common": join(repoDir, ".git"), "X-Orbit-Branch": "main", "X-Orbit-Git-Top": repoDir };
  await c.hook({ session_id: "pusher", hook_event_name: "SessionStart", cwd: repoDir }, head);
  await c.hook({ session_id: "pusher", hook_event_name: "PostToolUse", cwd: repoDir, tool_name: "Bash",
    tool_input: { command: "git push origin anna/x && gh pr create --head anna/x --title t" } }, head);
  expect((await c.entity("pr:github/acme/shop#9"))?.related).toContain("session:claude/pusher");
});
