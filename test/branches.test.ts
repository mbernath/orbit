// ADR-0024: which branches a session worked on itself, read from its commands.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchesOf, ownBranches } from "../src/sources/claude/branches";

test("Create a branch, push, open a PR", () => {
  expect(branchesOf("git checkout --no-track -b chore/sync origin/staging", "main")).toEqual(["chore/sync"]);
  expect(branchesOf("git switch -c feat/x", "main")).toEqual(["feat/x"]);
  expect(branchesOf("git worktree add -b feat/y ../y", "main")).toEqual(["feat/y"]);
  expect(branchesOf("git push -u origin feat/z", "main")).toEqual(["feat/z"]);
  expect(branchesOf("git push", "feat/current")).toEqual(["feat/current"]);
  expect(branchesOf("git push origin HEAD:feat/q", "x")).toEqual(["feat/q"]);
  expect(branchesOf('gh pr create --base staging --head chore/sync --title "Re-seed"', "main")).toEqual(["chore/sync"]);
  expect(branchesOf('gh pr create --title "x"', "feat/now")).toEqual(["feat/now"]);
  expect(branchesOf("git add . && git commit -m x && git push", "feat/a")).toEqual(["feat/a"]);
});

test("Only reading or switching to an existing branch does not count", () => {
  expect(branchesOf("git checkout feat/other", "main")).toEqual([]);
  expect(branchesOf("git status && git log --oneline", "feat/x")).toEqual([]);
  expect(branchesOf("gh pr view 488", "chore/sync")).toEqual([]);
});

test("From the transcript: the session's own branches, without the branch the checkout merely stood on", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-branches-"));
  const bash = (command: string, gitBranch: string) =>
    JSON.stringify({ type: "assistant", gitBranch, message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } });
  const author = join(dir, "author.jsonl");
  writeFileSync(author, [bash("git checkout -b chore/sync origin/staging", "feature/450"), bash('gh pr create --head chore/sync --title "x"', "chore/sync")].join("\n"));
  const bystander = join(dir, "bystander.jsonl");
  writeFileSync(bystander, [bash("bun test", "chore/sync"), bash("git status", "chore/sync")].join("\n"));
  expect(ownBranches(author)).toEqual(["chore/sync"]);
  expect(ownBranches(bystander)).toEqual([]);
});
