// Own worktree for a new session, on request only (ADR-0017): `.worktrees/<slug>` on a new branch `feat/<slug>`,
// named after the first message. Removal only on the user's click, and only when nothing would be lost.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../../core/types";
import { slugDe } from "../../core/util";

export type Worktree = { path: string; repo: string; branch: string };

/** Short name from the first words of a message: "Fix the login form, then …" → "fix-the-login-form". */
export function worktreeSlug(text: string): string {
  // first four words; umlauts spelled out before anything else, so "Räume" stays one word ("raeume")
  const words = slugDe(text).split("-").filter(Boolean).slice(0, 4);
  return words.join("-").slice(0, 40).replace(/-+$/, "") || "session";
}

/** @returns the new worktree, or an error */
export async function createWorktree(run: Runner, cwd: string, text: string): Promise<Worktree | { error: string }> {
  const top = await run(["git", "-C", cwd, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { error: "Folder without Git: no separate worktree possible." };
  const repo = top.stdout.trim();
  const base = worktreeSlug(text);
  let name = base;
  for (let n = 2; existsSync(join(repo, ".worktrees", name)); n++) name = `${base}-${n}`;
  const path = join(repo, ".worktrees", name);
  const branch = `feat/${name}`;
  const add = await run(["git", "-C", repo, "worktree", "add", "-b", branch, path]);
  if (add.code !== 0) return { error: `Couldn't create the worktree:${lastLine(add.stderr)}` };
  return { path, repo, branch };
}

/** Removes a worktree without --force: git refuses when it has changes, and so do we. The branch stays. */
export async function removeWorktree(run: Runner, w: { path: string; repo: string }): Promise<string | null> {
  const r = await run(["git", "-C", w.repo, "worktree", "remove", w.path]);
  if (r.code === 0) return null;
  return /modified or untracked|contains/.test(r.stderr)
    ? "The worktree has uncommitted changes. Nothing removed."
    : `Couldn't remove the worktree:${lastLine(r.stderr)}`;
}

const lastLine = (s: string) => s.trim().split("\n").pop() ?? "";
