// A filled board for the README's screenshots and video (scripts/readme-media/capture.ts): three islands with sessions in
// every state, pull requests, a list, an agent, a document and an owned session. Made-up projects in a temporary data
// directory; never touches ~/.orbit or ~/.claude, never runs gh or Claude Code. Prints "ready" once filled.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunner } from "../../src/core/runner";
import type { Runner } from "../../src/core/types";
import { createOrbit } from "../../src/server";
import { HOOK_EVENTS } from "../../src/sources/claude/hook-setup";
import { fakeClaude } from "../../test/e2e/fake-claude";

export const DEMO_PORT = Number(process.env.ORBIT_DEMO_PORT ?? 47931);
export const DEMO_TOKEN = "readme-demo-token";
// "tour": a calm board where every session works and nothing asks for you; capture.ts then sends events through stdin
const TOUR = process.env.ORBIT_DEMO_SCENE === "tour";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-readme-"))); // macOS: /var is /private/var, and pinned files resolve
const projects = join(home, "claude-projects");
mkdirSync(projects);
const hookCmd = [{ hooks: [{ type: "command", command: "/demo/orbit-hook.sh" }] }];
writeFileSync(join(home, "settings.json"), JSON.stringify({ effortLevel: "medium", hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, hookCmd])) }));

const dir = (name: string) => (mkdirSync(join(home, name), { recursive: true }), join(home, name));
const atlas = dir("atlas");
const kestrel = dir("kestrel");
const notes = dir("field-notes");
mkdirSync(join(atlas, ".git"));
writeFileSync(
  join(notes, "launch-plan.md"),
  "# Launch plan\n\nShip the public beta in two steps.\n\n## This week\n\n- [x] Freeze the API\n- [ ] Write the migration guide\n- [ ] Record the demo\n\n## Next week\n\n- Open the waitlist\n- Announce on the blog\n",
);
writeFileSync(
  join(home, "workspaces.json"),
  JSON.stringify([
    { id: "atlas", name: "atlas", paths: [atlas] },
    { id: "kestrel", name: "kestrel", paths: [kestrel] },
    { id: "notes", name: "field-notes", paths: [notes] },
  ]),
);

const transcript = join(home, "a1.jsonl");
writeFileSync(
  transcript,
  [
    { type: "user", message: { content: "The map tiles load slowly on first open. Find out why and fix it." } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/map/tiles.ts" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "fetchTile" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/map/tiles.ts" } }] } },
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "Tiles were fetched **one after another**. They now load in parallel, and the first screen is cached.\n\n```sh\nbun test src/map\n```\n\nFirst paint went from 2.4 s to 0.6 s." }] },
    },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n",
);

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const pr = (number: number, title: string, branch: string, author: string, extra: object) => ({
  number, title, url: `https://github.com/acme/atlas/pull/${number}`, headRefName: branch, author: { login: author }, isDraft: false, mergeable: "MERGEABLE", ...extra,
});
// atlas plays the GitHub repo acme/atlas; gh never runs for real
const run: Runner = async (cmd, cwd) => {
  if (cmd[0] === "code" || cmd[0] === "open") return ok();
  if (cmd.includes("--show-toplevel") && cmd[2]?.startsWith(atlas)) return ok(`${atlas}\n`);
  if (cmd[0] === "git" && cmd[3] === "remote") return cmd[2] === atlas ? ok("https://github.com/acme/atlas.git\n") : { code: 1, stdout: "", stderr: "" };
  if (cmd[0] === "gh" && cmd[1] === "api" && cmd[2] === "user") return ok("alex\n");
  if (cmd[0] === "gh" && cmd[1] === "repo") return ok(JSON.stringify({ squashMergeAllowed: true }));
  if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "list")
    return ok(TOUR ? "[]" : JSON.stringify([
      pr(41, "Load map tiles in parallel", "main", "alex", { mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", statusCheckRollup: [{ conclusion: "SUCCESS" }] }),
      pr(44, "Dark mode for the settings page", "sam/dark-settings", "sam", { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [], reviewRequests: [{ login: "alex" }] }),
      pr(45, "Bump the map SDK", "renovate/map-sdk", "sam", { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [], reviewRequests: [{ login: "alex" }] }),
    ]));
  if (cmd[0] === "gh") return { code: 1, stdout: "", stderr: "gh is not available in the demo" };
  if (cmd[0] === "env" && cmd.includes("--output-format")) // the agent trigger reader answers like Haiku would
    return ok(JSON.stringify({ type: "result", result: JSON.stringify({ kind: "event", type: "pr.merged", branch: "main" }) }));
  return defaultRunner(cmd, cwd);
};

const orbit = await createOrbit({
  home, port: DEMO_PORT, claudeProjects: projects, filesPollMs: 0, boardToken: DEMO_TOKEN, run, githubIntervalMs: 0,
  spawn: fakeClaude((body) => hook(body)),
});

const hook = (body: object) => {
  const cwd = (body as { cwd?: string }).cwd ?? "";
  const git: Record<string, string> = cwd.startsWith(atlas) ? { "X-Orbit-Git-Common": join(atlas, ".git"), "X-Orbit-Git-Top": atlas, "X-Orbit-Branch": "main" } : {};
  return fetch(`http://127.0.0.1:${DEMO_PORT}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orbit-Token": orbit.hookToken, ...git },
    body: JSON.stringify(body),
  });
};
const act = (id: string, input: object) =>
  fetch(`http://127.0.0.1:${DEMO_PORT}/api/actions/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orbit-Token": DEMO_TOKEN, Origin: `http://127.0.0.1:${DEMO_PORT}` },
    body: JSON.stringify({ input }),
  }).then(async (r) => r.ok || console.error(id, "failed", r.status, await r.text()));

const start = async (id: string, cwd: string, prompt: string, transcriptPath?: string) => {
  await hook({ session_id: id, hook_event_name: "SessionStart", cwd, ...(transcriptPath ? { transcript_path: transcriptPath } : {}) });
  await hook({ session_id: id, hook_event_name: "UserPromptSubmit", cwd, prompt });
};

if (TOUR) {
  await start("a1", atlas, "Speed up the first map load", transcript);
  await start("a3", atlas, "Add offline mode to the map");
  await start("k2", kestrel, "Move the billing jobs to the queue");
  await start("k3", kestrel, "Document the webhook payloads");
  await act("lists.add", { workspaceId: "kestrel", command: join(import.meta.dirname, "..", "orbit-list-demo.sh"), title: "Roadmap" });
  await act("files.pin", { path: join(notes, "launch-plan.md") });
  // a session Orbit runs: its first turn ends at once and is marked seen, so it rests until capture.ts writes to it
  const res = await fetch(`http://127.0.0.1:${DEMO_PORT}/api/actions/owned.start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orbit-Token": DEMO_TOKEN, Origin: `http://127.0.0.1:${DEMO_PORT}` },
    body: JSON.stringify({ input: { cwd: notes, text: "Draft the beta announcement", model: "sonnet" } }),
  }).then((r) => r.json() as Promise<{ data: { id: string } }>);
  await Bun.sleep(300);
  await act("claude.ack", { id: res.data.id });
  console.log(`owned ${res.data.id}`);
  console.log(`ready http://127.0.0.1:${DEMO_PORT}/ (data: ${home})`);
  // one JSON line per step: {"hook": {...}} posts a hook event, {"act": [id, input]} runs a board action
  for await (const line of console) {
    const step = JSON.parse(line) as { hook?: object; act?: [string, object] };
    if (step.hook) await hook({ cwd: atlas, ...step.hook }); // the tour's hook events are atlas sessions
    if (step.act) await act(...step.act);
  }
  process.exit(0);
}

// atlas: one finished with a transcript, one asking for Bash, one at work
await start("a1", atlas, "Speed up the first map load", transcript);
await hook({ session_id: "a1", hook_event_name: "Stop", cwd: atlas, last_assistant_message: "Tiles now load in parallel; first paint went from 2.4 s to 0.6 s." });
await start("a2", atlas, "Fix the flaky geocoder test");
await hook({ session_id: "a2", hook_event_name: "PermissionRequest", cwd: atlas, tool_name: "Bash", tool_input: { command: "bun test geocoder --rerun-each 20" } });
await hook({ session_id: "a2", hook_event_name: "Notification", cwd: atlas, message: "Claude needs your permission to use Bash" });
await start("a3", atlas, "Add offline mode to the map");
const todos = [{ content: "Cache tiles in IndexedDB", status: "completed" }, { content: "Serve from cache when offline", status: "in_progress" }, { content: "Show an offline badge", status: "pending" }];
await hook({ session_id: "a3", hook_event_name: "PostToolUse", cwd: atlas, tool_name: "TodoWrite", tool_input: { todos } });

// kestrel: a question, one at work, one done
await start("k1", kestrel, "Rate limits for the public API");
await hook({ session_id: "k1", hook_event_name: "PermissionRequest", cwd: kestrel, tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Limit per API key or per IP address?" }] } });
await hook({ session_id: "k1", hook_event_name: "Notification", cwd: kestrel, message: "Limit per API key or per IP address?" });
await start("k2", kestrel, "Move the billing jobs to the queue");
await start("k3", kestrel, "Document the webhook payloads");
await hook({ session_id: "k3", hook_event_name: "Stop", cwd: kestrel, last_assistant_message: "Added docs/webhooks.md with all six payloads and an example each." });

// field-notes: a pinned plan, a roadmap list, an agent, and a session Orbit runs itself
await act("files.pin", { path: join(notes, "launch-plan.md") });
await act("lists.add", { workspaceId: "kestrel", command: join(import.meta.dirname, "..", "orbit-list-demo.sh"), title: "Roadmap" });
await act("agents.create", { workspaceId: "notes", name: "Changelog", role: "Writes the changelog entry after every merge.", trigger: "after every merge into main" });
await act("owned.start", { cwd: notes, text: "Draft the beta announcement", model: "sonnet" });

console.log(`ready http://127.0.0.1:${DEMO_PORT}/ (data: ${home})`);
