// Starts Orbit for the browser tests: a fresh data directory, two workspaces, a few sessions.
// Never touches ~/.orbit or ~/.claude.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunner } from "../../src/core/runner";
import type { Runner } from "../../src/core/types";
import { createOrbit } from "../../src/server";
import { HOOK_EVENTS } from "../../src/sources/claude/hook-setup";
import { fakeClaude } from "./fake-claude";

export const E2E_PORT = Number(process.env.ORBIT_E2E_PORT ?? 47911);

const home = mkdtempSync(join(tmpdir(), "orbit-e2e-"));
const projects = join(home, "claude-projects");
mkdirSync(projects);
// Claude's own settings beside the projects (ADR-0025): thinking "normal", nothing else set
// and Orbit's hook installed for every event, so no hook notice covers the board (ADR-0031, ADR-0041)
const orbitHook = [{ hooks: [{ type: "command", command: "/fixture/orbit/hooks/orbit-hook.sh" }] }];
writeFileSync(join(home, "settings.json"), JSON.stringify({ effortLevel: "medium", hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, orbitHook])) }));
// a real folder for documents (files need real paths) and a transcript for the detail panel
const notes = join(home, "notes");
const kestrel = join(home, "kestrel"); // a real folder, so a session there can be taken over
mkdirSync(kestrel);
mkdirSync(notes);
writeFileSync(join(notes, "README.md"), "# Notes\n\nFirst line of the notes.\n");
const transcript = join(home, "s1.jsonl");
writeFileSync(
  transcript,
  [
    { type: "user", message: { content: "Make the import faster" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/import.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "readFileSync" } }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "The import now reads **only the end** of the file.\n\n```sh\nbun run import --tail\n```" }] } },
    { type: "user", message: { content: "<task-notification>\n<status>completed</status>\n<summary>Tests passing</summary>\n</task-notification>" } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n",
);
export const BOARD_TOKEN = "e2e-board-token";
writeFileSync(
  join(home, "workspaces.json"),
  JSON.stringify([
    { id: "orbit", name: "orbit", paths: ["/fixture/orbit", notes] },
    { id: "kestrel", name: "kestrel", paths: [kestrel] },
  ]),
);

// opening a file (ADR-0030) is recorded for the tests, never run: no editor or browser pops up
// notes plays a git repo (ADR-0017): worktrees are created and removed as plain folders, other commands run for real
const run: Runner = async (cmd, cwd) => {
  if (cmd[0] === "code" || cmd[0] === "open") return appendFileSync(join(home, "opened.jsonl"), `${JSON.stringify(cmd)}\n`), { code: 0, stdout: "", stderr: "" };
  if (cmd.includes("--show-toplevel") && cmd[2]?.startsWith(notes)) return { code: 0, stdout: `${notes}\n`, stderr: "" };
  if (cmd[3] === "worktree" && cmd[4] === "add") return mkdirSync(cmd.at(-1) as string, { recursive: true }), { code: 0, stdout: "", stderr: "" };
  if (cmd[3] === "worktree" && cmd[4] === "remove") return rmSync(cmd.at(-1) as string, { recursive: true }), { code: 0, stdout: "", stderr: "" };
  // notes is also the GitHub repo acme/notes with one PR on main whose CI is red (ADR-0014); gh never runs for real
  if (cmd[0] === "git" && cmd[3] === "remote") return cmd[2] === notes ? { code: 0, stdout: "https://github.com/acme/notes.git\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
  if (cmd[0] === "gh" && cmd[1] === "api" && cmd[2] === "user") return { code: 0, stdout: "alex\n", stderr: "" };
  if (cmd[0] === "gh" && cmd[1] === "repo") return { code: 0, stdout: JSON.stringify({ squashMergeAllowed: true }), stderr: "" };
  if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "list")
    return { code: 0, stderr: "", stdout: JSON.stringify([{
      number: 7, title: "Rework the export", url: "https://github.com/acme/notes/pull/7", headRefName: "feat/fix-the-export", author: { login: "alex" },
      isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE", reviewDecision: null, statusCheckRollup: [{ conclusion: "FAILURE" }],
    }, ...[11, 12].map((number) => ({ // someone else's, asking for the user's review, no session (ADR-0038)
      number, title: `Someone else's PR ${number}`, url: `https://github.com/acme/notes/pull/${number}`, headRefName: `anna/${number}`, author: { login: "anna" },
      isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [], reviewRequests: [{ login: "alex" }],
    }))]) };
  if (cmd[0] === "gh") return { code: 1, stdout: "", stderr: "gh is not available in the test" };
  // the agent trigger reader (`env -u … claude -p --output-format json …`, ADR-0016) answers like Haiku would
  if (cmd[0] === "env" && cmd.includes("--output-format")) {
    const trigger = (cmd.at(-1) ?? "").split("\n").pop() ?? ""; // the last prompt line: Trigger: "…"
    const rule = /merge/i.test(trigger) ? { kind: "event", type: "pr.merged", branch: "main" } : { understood: false };
    return { code: 0, stdout: JSON.stringify({ type: "result", result: JSON.stringify(rule) }), stderr: "" };
  }
  return defaultRunner(cmd, cwd);
};
mkdirSync(join(notes, ".git")); // discovery finds the repo; every git call on it is answered above

const orbit = await createOrbit({
  home, port: E2E_PORT, claudeProjects: projects, filesPollMs: 0, boardToken: BOARD_TOKEN, run, githubIntervalMs: 0,
  spawn: fakeClaude((body) => hook(body)), // owned sessions never start the real Claude Code
});

/** Posts a hook event; for folders in notes it adds what the real hook reports about git (main repo, checkout top). */
const hook = (body: object) => {
  const cwd = (body as { cwd?: string }).cwd ?? "";
  const top = cwd.startsWith(join(notes, ".worktrees")) ? cwd.split("/").slice(0, notes.split("/").length + 2).join("/") : notes;
  const git: Record<string, string> = cwd.startsWith(notes) ? { "X-Orbit-Git-Common": join(notes, ".git"), "X-Orbit-Git-Top": top, "X-Orbit-Branch": top === notes ? "main" : `feat/${top.split("/").pop()}` } : {};
  return fetch(`http://127.0.0.1:${E2E_PORT}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orbit-Token": orbit.hookToken, ...git },
    body: JSON.stringify(body),
  });
};

for (const [id, cwd, prompt] of [
  ["s1", "/fixture/orbit", "Speed up transcript import"],
  ["s2", "/fixture/orbit", "Moodboard for the design system"],
  ["s3", kestrel, "Pipeline view by stage"],
] as const) {
  await hook({ session_id: id, hook_event_name: "SessionStart", cwd, ...(id === "s1" ? { transcript_path: transcript } : {}) });
  await hook({ session_id: id, hook_event_name: "UserPromptSubmit", cwd, prompt });
}
// s2 runs in VS Code and asks for Bash: the hook reports the command, then Claude Code's English notification
await hook({ session_id: "s2", hook_event_name: "PermissionRequest", cwd: "/fixture/orbit", tool_name: "Bash", tool_input: { command: "npm test" } });
await hook({ session_id: "s2", hook_event_name: "Notification", cwd: "/fixture/orbit", message: "Claude needs your permission to use Bash" });
// s3 keeps a task list and asks a question of its own (ADR-0027)
const todos = [{ content: "Read the stages", status: "completed" }, { content: "Build the view", status: "in_progress" }, { content: "Test", status: "pending" }];
await hook({ session_id: "s3", hook_event_name: "PostToolUse", cwd: kestrel, tool_name: "TodoWrite", tool_input: { todos } });
await hook({ session_id: "s3", hook_event_name: "PermissionRequest", cwd: kestrel, tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Should paused be a stage of its own?" }] } });
await hook({ session_id: "s3", hook_event_name: "Notification", cwd: kestrel, message: "Should paused be a stage of its own?" });

// s4 finished its work in a worktree of notes, and its PR #5 was merged (ADR-0023): the record the github source
// keeps after noticing a merge, written directly because the fixture has no history of refreshes
const finished = join(notes, ".worktrees", "finished");
await hook({ session_id: "s4", hook_event_name: "SessionStart", cwd: finished });
await hook({ session_id: "s4", hook_event_name: "UserPromptSubmit", cwd: finished, prompt: "Finish the export" });
await hook({ session_id: "s4", hook_event_name: "Stop", cwd: finished, last_assistant_message: "It's merged." });
orbit.db.run(
  `INSERT INTO github_merged (repo, number, title, url, branch, base, dir, workspace_id, merged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ["acme/notes", 5, "Finish the export", "https://github.com/acme/notes/pull/5", "feat/finished", "main", notes, "orbit", Date.now() - 2 * 3600_000],
);

// a pinned document in the orbit island
await fetch(`http://127.0.0.1:${E2E_PORT}/api/actions/files.pin`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Orbit-Token": BOARD_TOKEN, Origin: `http://127.0.0.1:${E2E_PORT}` },
  body: JSON.stringify({ input: { path: join(notes, "README.md") } }),
}).then(async (r) => r.ok || console.error("pin failed", r.status, await r.text()));

console.log(`Orbit e2e server on ${E2E_PORT} (data: ${home})`);
