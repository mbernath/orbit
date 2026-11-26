// Claude source end to end: hooks, transcript import, titles, archive, workspace assignment.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client } from "./helpers";

const home = mkdtempSync(join(tmpdir(), "orbit-test-"));
const port = 47300 + Math.floor(Math.random() * 400); // stays clear of the e2e port 47911
const projects = join(home, "claude-projects");
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const { hook, action, session, element, state } = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);

function writeTranscript(cwd: string, id: string, lines: object[]) {
  const dir = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify({ sessionId: id, ...l })).join("\n") + "\n");
}

beforeAll(async () => {
  writeFileSync(
    join(home, "workspaces.json"),
    JSON.stringify([
      { id: "portal", name: "Customer portal", paths: ["/work/portal"] },
      { id: "portal-ui", name: "Portal UI", paths: ["/work/portal/ui"] },
    ]),
  );
  // Existing transcript in a workspace path, imported at startup.
  writeTranscript("/work/portal", "old-1", [
    { type: "user", cwd: "/work/portal", gitBranch: "main", timestamp: "2026-01-01T10:00:00Z", message: { content: [{ type: "text", text: "<ide_opened_file>x</ide_opened_file>" }, { type: "text", text: "Old task" }] } },
    { type: "assistant", cwd: "/work/portal", timestamp: "2026-01-01T10:05:00Z", message: { content: [{ type: "text", text: "Done." }] } },
  ]);
  orbit = await createOrbit({ home, port, claudeProjects: projects, github: false, boardToken: BOARD_TOKEN });
});
afterAll(() => orbit.stop());

const data = (e: any) => e.data as Record<string, any>;

test("Life cycle of a session", async () => {
  await hook({ session_id: "a", hook_event_name: "SessionStart", cwd: "/work/portal" });
  expect((await session("a"))!.status).toBe("idle");

  await hook({ session_id: "a", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "Build the login\nwith a magic link" });
  let s = (await session("a"))!;
  expect(s.status).toBe("working");
  expect(s.title).toBe("Build the login with a magic link");
  expect(s.attention).toBe(null);

  // not Claude's own "needs your permission" notice, which never becomes the last message
  await hook({ session_id: "a", hook_event_name: "Notification", message: "Claude would like your approval" });
  s = (await session("a"))!;
  expect(s.status).toBe("waiting");
  expect(s.attention?.level).toBe("waiting");
  expect(data(s).lastMessage).toBe("Claude would like your approval");
  expect(s.actions).toContain("claude.ack");

  expect((await action("claude.ack", { id: "a" })).status).toBe(200);
  expect((await session("a"))!.attention).toBe(null);

  await hook({ session_id: "a", hook_event_name: "Stop", last_assistant_message: "The login is done." });
  s = (await session("a"))!;
  expect(s.status).toBe("done");
  expect(s.attention?.level).toBe("done");
  expect(data(s).lastMessage).toBe("The login is done.");
  // ADR-0020: a finished turn is a domain event other sources (agents) can react to
  const ev = orbit.db.query(`SELECT payload FROM event_log WHERE type = 'event.session.done' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  expect(JSON.parse(ev.payload)).toMatchObject({ type: "session.done", sessionId: "a" });
});

test("The last reply is read from the transcript when the event lacks it", async () => {
  const transcript = join(home, "t.jsonl");
  writeFileSync(
    transcript,
    [
      { type: "user", message: { content: "Hello" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Three variants are ready." }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
    ].map((l) => JSON.stringify(l)).join("\n"),
  );
  await hook({ session_id: "t", hook_event_name: "Stop", cwd: "/elsewhere", transcript_path: transcript });
  expect(data(await session("t")).lastMessage).toBe("Three variants are ready.");
});

test("Workspace assignment: the longest path wins, worktrees count towards the main repo", async () => {
  await hook({ session_id: "ui", hook_event_name: "SessionStart", cwd: "/work/portal/ui/src" });
  expect((await session("ui"))!.workspaceId).toBe("portal-ui");

  // Conductor worktree lives elsewhere; git-common-dir points at the main repo.
  await hook(
    { session_id: "wt", hook_event_name: "SessionStart", cwd: "/Users/m/conductor/portal/feature-x" },
    { "X-Orbit-Git-Common": "/work/portal/.git", "X-Orbit-Branch": "feature-x" },
  );
  const wt = (await session("wt"))!;
  expect(wt.workspaceId).toBe("portal");
  expect(data(wt).branch).toBe("feature-x");
  expect(wt.keys).toEqual(["claude:wt", "git:/work/portal#feature-x"]);
  expect(data(wt).workTree).toBe(null); // an older hook sends no top: unknown, stays null

  // ADR-0017: the hook reports the top of the checkout; a top other than the main repo is an own worktree
  const top = (t: string) => ({ "X-Orbit-Git-Common": "/work/portal/.git", "X-Orbit-Branch": "feature-x", "X-Orbit-Git-Top": t });
  await hook({ session_id: "wt", hook_event_name: "UserPromptSubmit", cwd: "/Users/m/conductor/portal/feature-x", prompt: "x" }, top("/Users/m/conductor/portal/feature-x"));
  expect(data((await session("wt"))!).workTree).toBe("/Users/m/conductor/portal/feature-x");
  await hook({ session_id: "wt", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "y" }, top("/work/portal"));
  expect(data((await session("wt"))!).workTree).toBe(null); // back in the main checkout

  await hook({ session_id: "none", hook_event_name: "SessionStart", cwd: "/work/portalxyz" });
  expect((await session("none"))!.workspaceId).toBe(null);
});

test("Creating and deleting workspaces", async () => {
  expect((await action("workspaces.add", { name: "" })).status).toBe(400);

  const res = await action("workspaces.add", { name: "Customer portal", path: "/work/other" });
  const { data: created } = (await res.json()) as any;
  expect(created.id).toBe("customer-portal");
  expect((await state()).workspaces.map((w) => w.id)).toContain("customer-portal");

  await action("workspaces.remove", { id: created.id });
  expect((await state()).workspaces.map((w) => w.id)).not.toContain("customer-portal");
});

test("Invalid events are rejected, the board is served with its token", async () => {
  expect((await hook({ hook_event_name: "Stop" })).status).toBe(400);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  expect(html).toContain('<main id="viewport"');
  expect(html).not.toContain("Needs you"); // the sidebar is replaced by minimap and edge hints (ADR-0013)
  expect(html).toContain(`<meta name="orbit-token" content="${BOARD_TOKEN}"`);
  expect((await fetch(`http://127.0.0.1:${port}/../package.json`)).status).toBe(404);
});

test("Existing sessions are imported at startup", async () => {
  const s = (await session("old-1"))!;
  expect(s.status).toBe("inactive");
  expect(s.title).toBe("Old task");
  expect(data(s).branch).toBe("main");
  expect(data(s).lastMessage).toBe("Done.");
  expect(s.workspaceId).toBe("portal");
  expect(s.updatedAt).toBe(Date.parse("2026-01-01T10:05:00Z"));
  expect(await element("session:claude/old-1")).toBeUndefined(); // implicit element, no row yet
});

test("A new workspace picks up its existing sessions, not those of other paths", async () => {
  writeTranscript("/work/shop", "shop-1", [
    { type: "ai-title", aiTitle: "Fix the cart" },
    { type: "user", cwd: "/work/shop/api", timestamp: "2026-02-01T09:00:00Z", message: { content: "fix cart" } },
  ]);
  writeTranscript("/work/shopping", "shopping-1", [
    { type: "user", cwd: "/work/shopping", timestamp: "2026-02-01T09:00:00Z", message: { content: "another project" } },
  ]);
  expect(await session("shop-1")).toBeUndefined();

  await action("workspaces.add", { name: "Shop", path: "/work/shop" });
  const s = (await session("shop-1"))!;
  expect(s.title).toBe("Fix the cart");
  expect(s.workspaceId).toBe("shop");
  expect(await session("shopping-1")).toBeUndefined();
});

test("The title comes from the transcript, not from the last prompt", async () => {
  const transcript = join(home, "titled.jsonl");
  await hook({ session_id: "ti", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "go ahead" });
  expect((await session("ti"))!.title).toBe("go ahead"); // fallback until Claude has named the topic

  writeFileSync(transcript, [
    JSON.stringify({ type: "user", message: { content: "go ahead" } }),
    JSON.stringify({ type: "ai-title", aiTitle: "First draft" }),
    JSON.stringify({ type: "ai-title", aiTitle: "Login via magic link" }),
  ].join("\n"));
  await hook({ session_id: "ti", hook_event_name: "Stop", transcript_path: transcript, last_assistant_message: "ok" });
  await hook({ session_id: "ti", hook_event_name: "UserPromptSubmit", prompt: "and now the tests" });
  expect((await session("ti"))!.title).toBe("Login via magic link");
});

test("Renaming and resetting", async () => {
  await action("claude.rename", { id: "ti", title: "  My   login  " });
  let s = (await session("ti"))!;
  expect(s.title).toBe("My login");
  expect(data(s).customTitle).toBe("My login");
  expect(data(s).autoTitle).toBe("Login via magic link");

  await action("claude.rename", { id: "ti", title: null });
  s = (await session("ti"))!;
  expect(s.title).toBe("Login via magic link");
  expect(data(s).customTitle).toBe(null);
});

test("The card position belongs to the element, not to the session", async () => {
  const ref = "session:claude/ti";
  expect((await action("canvas.place", { ref, x: 120.5, y: -40 })).status).toBe(200);
  expect(await element(ref)).toMatchObject({ ref, x: 120.5, y: -40, archived: false });
  expect((await action("canvas.place", { ref, x: "a", y: 1 })).status).toBe(400);
  await action("canvas.unplace", { refs: [ref] });
  expect(await element(ref)).toMatchObject({ x: null, y: null });
});

test("A hook event brings an imported session back to life", async () => {
  await hook({ session_id: "old-1", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "continue" });
  const s = (await session("old-1"))!;
  expect(s.status).toBe("working");
  expect(s.title).toBe("Old task");
});

test("Archiving: stays away on re-import, comes back on new activity", async () => {
  const ref = "session:claude/old-1";
  await hook({ session_id: "old-1", hook_event_name: "Stop", last_assistant_message: "done" });
  expect((await session("old-1"))!.attention).not.toBe(null);

  await action("canvas.archive", { refs: [ref], archived: true });
  expect((await element(ref))!.archived).toBe(true);
  expect((await session("old-1"))!.attention).toBe(null); // archived sessions never wait in "Needs you"

  // A changed transcript is re-imported but must not un-archive the session.
  writeTranscript("/work/portal", "old-1", [
    { type: "user", cwd: "/work/portal", timestamp: "2026-01-02T10:00:00Z", message: { content: "Old task" } },
    { type: "ai-title", aiTitle: "New title" },
  ]);
  await action("claude.import");
  expect((await element(ref))!.archived).toBe(true);

  await action("canvas.archive", { refs: [ref], archived: false });
  expect((await element(ref))!.archived).toBe(false);

  await action("canvas.archive", { refs: [ref], archived: true });
  await hook({ session_id: "old-1", hook_event_name: "UserPromptSubmit", prompt: "let's go on" });
  expect((await element(ref))!.archived).toBe(false);
});

test("SessionEnd makes a session inactive", async () => {
  await hook({ session_id: "end", hook_event_name: "SessionStart", cwd: "/work/portal" });
  await hook({ session_id: "end", hook_event_name: "SessionEnd" });
  expect((await session("end"))!.status).toBe("inactive");
});

test("Conversation for the detail window: prompts, replies, one step per tool, read only", async () => {
  const file = join(home, "conv.jsonl");
  writeFileSync(
    file,
    [
      { type: "user", timestamp: "2026-01-02T10:00:00Z", message: { content: [{ type: "text", text: "<ide_selection>x</ide_selection>" }, { type: "text", text: "Make the import faster" }] } },
      { type: "assistant", timestamp: "2026-01-02T10:01:00Z", message: { content: [{ type: "text", text: "Let me look." }, { type: "tool_use", name: "Read", input: { file_path: "/w/src/a.ts" } }] } },
      { type: "user", timestamp: "2026-01-02T10:01:05Z", message: { content: [{ type: "tool_result", content: "…" }] } },
      { type: "assistant", timestamp: "2026-01-02T10:02:00Z", message: { content: [{ type: "text", text: "Done." }] } },
      { type: "user", timestamp: "2026-01-02T10:03:00Z", message: { content: "<task-notification>\n<status>completed</status>\n<summary>CI green</summary>\n</task-notification>" } },
      { type: "assistant", timestamp: "2026-01-02T10:04:00Z", message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }] } }] } },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
  await hook({ session_id: "conv", hook_event_name: "SessionStart", cwd: "/work/portal", transcript_path: file });
  const res = await fetch(`http://127.0.0.1:${port}/api/conversation?id=conv`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { role: "you", text: "Make the import faster", at: Date.parse("2026-01-02T10:00:00Z") },
    { role: "ai", text: "Let me look.", at: Date.parse("2026-01-02T10:01:00Z") },
    { role: "tool", text: "Read /w/src/a.ts", at: Date.parse("2026-01-02T10:01:00Z") },
    { role: "ai", text: "Done.", at: Date.parse("2026-01-02T10:02:00Z") },
    { role: "note", text: "Background task done: CI green", at: Date.parse("2026-01-02T10:03:00Z") },
    { role: "note", text: "Tasks 1/2", at: Date.parse("2026-01-02T10:04:00Z") },
  ]);
  expect((await fetch(`http://127.0.0.1:${port}/api/conversation?id=nope`)).status).toBe(404);
});

test("Renaming an island changes only the name, not the id", async () => {
  expect((await action("workspaces.rename", { id: "portal", name: "Portal" })).status).toBe(200);
  const ws = (await state()).workspaces.find((w) => w.id === "portal");
  expect(ws?.name).toBe("Portal");
  expect((await action("workspaces.rename", { id: "portal", name: " " })).status).toBe(400);
  expect((await action("workspaces.rename", { id: "nope", name: "X" })).status).toBe(400);
  await action("workspaces.rename", { id: "portal", name: "Customer portal" });
});

test("Permission request of an observed session: the concrete command shows until the session works on", async () => {
  await hook({ session_id: "perm", hook_event_name: "SessionStart", cwd: "/work/portal" });
  await hook({ session_id: "perm", hook_event_name: "PermissionRequest", cwd: "/work/portal", tool_name: "Bash", tool_input: { command: "npm test", description: "Tests" } });
  await hook({ session_id: "perm", hook_event_name: "Notification", cwd: "/work/portal", message: "Claude needs your permission to use Bash" });
  let s = (await session("perm"))!;
  expect(s.status).toBe("waiting");
  expect(data(s).question).toBe("Bash npm test");
  expect(data(s).questionKind).toBe("permission");
  expect(s.attention?.level).toBe("waiting");

  await hook({ session_id: "perm", hook_event_name: "Stop", cwd: "/work/portal", last_assistant_message: "done" });
  s = (await session("perm"))!;
  expect(data(s).question).toBe(null);
});

test("ADR-0027: question and plan as reasons to wait, progress from the task list", async () => {
  await hook({ session_id: "ask", hook_event_name: "SessionStart", cwd: "/work/portal" });
  await hook({ session_id: "ask", hook_event_name: "PermissionRequest", cwd: "/work/portal", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which variant?" }] } });
  let s = (await session("ask"))!;
  expect([data(s).questionKind, data(s).question]).toEqual(["question", "Which variant?"]);
  await hook({ session_id: "ask", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "AskUserQuestion" });
  expect(data((await session("ask"))!).questionKind).toBe(null);

  await hook({ session_id: "ask", hook_event_name: "PermissionRequest", cwd: "/work/portal", tool_name: "ExitPlanMode", tool_input: { plan: "# Speed up the import" } });
  s = (await session("ask"))!;
  expect([data(s).questionKind, data(s).question]).toEqual(["plan", "Speed up the import"]);

  const todos = [{ content: "a", status: "completed" }, { content: "b", status: "in_progress", activeForm: "Doing b" }, { content: "c", status: "pending" }];
  await hook({ session_id: "ask", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "TodoWrite", tool_input: { todos } });
  expect(data((await session("ask"))!).progress).toEqual({ done: 1, total: 3, current: "Doing b" });
});

test("After a permission is granted the session works again; Claude's notice never becomes the last message", async () => {
  await hook({ session_id: "allow", hook_event_name: "SessionStart", cwd: "/work/portal" });
  await hook({ session_id: "allow", hook_event_name: "Stop", cwd: "/work/portal", last_assistant_message: "I'm checking the tests now." });
  await hook({ session_id: "allow", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "continue" });
  await hook({ session_id: "allow", hook_event_name: "PermissionRequest", cwd: "/work/portal", tool_name: "Bash", tool_input: { command: "npm test" } });
  await hook({ session_id: "allow", hook_event_name: "Notification", cwd: "/work/portal", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  let s = (await session("allow"))!;
  expect(s.status).toBe("waiting");
  expect(data(s).lastMessage).toBe("I'm checking the tests now.");
  // the user allowed it (in Orbit or in VS Code): the tool runs, PostToolUse arrives
  await hook({ session_id: "allow", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "Bash" });
  s = (await session("allow"))!;
  expect(s.status).toBe("working");
  expect(s.attention).toBe(null);
  expect(data(s).question).toBe(null);
  // PostToolUse never wakes a finished session
  await hook({ session_id: "allow", hook_event_name: "Stop", cwd: "/work/portal", last_assistant_message: "done" });
  await hook({ session_id: "allow", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "Read" });
  expect((await session("allow"))!.status).toBe("done");
});

test("A parallel tool finishing during a permission prompt does not end the wait (ADR-0027)", async () => {
  await hook({ session_id: "par", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "go" });
  await hook({ session_id: "par", hook_event_name: "PermissionRequest", cwd: "/work/portal", tool_name: "Bash", tool_input: { command: "awk 1 x" } });
  // started before the prompt, finishes while it is open
  await hook({ session_id: "par", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "Bash", tool_input: { command: "ssh host ls" } });
  await hook({ session_id: "par", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "Read", tool_input: { file_path: "/a.md" } });
  let s = (await session("par"))!;
  expect(s.status).toBe("waiting");
  expect(data(s).question).not.toBe(null);
  // the asked tool ran: the permission was granted
  await hook({ session_id: "par", hook_event_name: "PostToolUse", cwd: "/work/portal", tool_name: "Bash", tool_input: { command: "awk 1 x" } });
  s = (await session("par"))!;
  expect(s.status).toBe("working");
  expect(data(s).question).toBe(null);
});

test("A session Orbit started names itself in its first reply (ADR-0032)", async () => {
  const file = join(home, "own-title.jsonl");
  const write = (...extra: object[]) => writeFileSync(file, [
    { type: "user", timestamp: "2026-01-02T10:00:00Z", message: { content: "Briefly explain what a Git rebase is." } },
    { type: "assistant", timestamp: "2026-01-02T10:01:00Z", message: { content: [{ type: "text", text: "[Title: Git rebase briefly explained]\n\nA rebase replays commits." }] } },
    { type: "assistant", timestamp: "2026-01-02T10:02:00Z", message: { content: [{ type: "text", text: "[Title: Not any more later]\n\nOne more thing." }] } },
    ...extra,
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  write();
  await hook({ session_id: "own-t", hook_event_name: "UserPromptSubmit", cwd: "/work/portal", prompt: "Briefly explain what a Git rebase is." });
  await hook({ session_id: "own-t", hook_event_name: "Stop", transcript_path: file, last_assistant_message: "[Title: Git rebase briefly explained]\n\nA rebase replays commits." });
  const s = (await session("own-t"))!;
  expect(s.title).toBe("Git rebase briefly explained"); // the first reply's line, not a later one
  expect(data(s).lastMessage).toBe("A rebase replays commits."); // the line itself is not shown
  const conv = (await (await fetch(`http://127.0.0.1:${port}/api/conversation?id=own-t`)).json()) as any[];
  expect(conv.filter((e) => e.role === "ai").map((e) => e.text)).toEqual(["A rebase replays commits.", "One more thing."]);

  // Claude Code's own topic title wins where it writes one
  write({ type: "ai-title", aiTitle: "Rebase explanation" });
  await hook({ session_id: "own-t", hook_event_name: "Stop", transcript_path: file, last_assistant_message: "One more thing." });
  expect((await session("own-t"))!.title).toBe("Rebase explanation");
});
