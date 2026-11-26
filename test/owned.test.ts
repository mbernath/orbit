// Owned sessions (ADR-0019): Orbit runs `claude -p` itself. Played against recorded streams, never the real CLI.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/core/types";
import { createOrbit } from "../src/server";
import { TITLE_PROMPT } from "../src/core/util";
import { applyLine, initialRun } from "../src/sources/owned/stream";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-owned-")));
const ws = join(home, "work");
const port = 47700 + Math.floor(Math.random() * 150);
const replay = replaySpawner(streamFixture("permission-allow-two-turns"), streamFixture("resume"), streamFixture("simple"), streamFixture("simple"));
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
const json = async (r: Response) => (await r.json()) as any;
const control = async (id: string) => c.entity(`control:owned/${id}`);
/** wait until the condition holds (the stub answers asynchronously, like the CLI) */
async function until<T>(f: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await f();
    if (ok(v)) return v;
    await Bun.sleep(5);
  }
  throw new Error("timed out");
}

// git stub (ADR-0017): the workspace is a repo; removing a worktree fails once with changes, then works
const git: string[][] = [];
let dirty = true;
const run: Runner = async (cmd) => {
  git.push(cmd);
  if (cmd.includes("--show-toplevel")) return { code: 0, stdout: `${ws}\n`, stderr: "" };
  if (cmd.includes("remove") && dirty) return ((dirty = false), { code: 128, stdout: "", stderr: "fatal: '.worktrees/x' contains modified or untracked files, use --force to delete it" });
  return { code: 0, stdout: "", stderr: "" };
};

const start = () =>
  createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, spawn: replay.spawn, run });

beforeAll(async () => {
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }]));
  process.env.ANTHROPIC_API_KEY = "sk-test-must-not-pass"; // must never reach the child
  orbit = await start();
});
afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  return orbit.stop();
});

test("Stream parsing: question, answer, end of turn and usage from a real recording", () => {
  let s = initialRun();
  const seen: string[] = [];
  for (const line of streamFixture("permission-allow-two-turns")) {
    const ev = applyLine(s, line);
    s = ev.state;
    if (s.permission && !seen.includes("question")) seen.push("question");
    if (ev.kind === "turn-end") seen.push(`end:${s.lastText}`);
  }
  expect(seen).toEqual(["question", "end:fertig", "end:zwei"]); // the recorded replies
  expect(s.status).toBe("idle");
  expect(s.usage?.fiveHour).toBe(0.06);
  expect(s.model).toContain("haiku");
  expect(applyLine(s, "not json").state).toBe(s);
});

test("An assistant line after a permission request (parallel tool, subagent) keeps the session asking", () => {
  const lines = streamFixture("permission-deny");
  const ask = lines.findIndex((l) => l.includes('"control_request"'));
  const assistant = lines.find((l) => JSON.parse(l).type === "assistant");
  expect(ask).toBeGreaterThan(0);
  expect(assistant).toBeDefined();
  let s = initialRun();
  for (const line of [...lines.slice(0, ask + 1), assistant!]) s = applyLine(s, line).state;
  expect(s.permission?.tool).toBe("Write");
  expect(s.status).toBe("permission");
});

test("New session: own ID, own login without API key, folder must be inside an island", async () => {
  expect((await json(await c.action("owned.start", { cwd: "/nowhere", text: "hello" }))).error).toBe("Folder not found.");
  expect((await json(await c.action("owned.start", { cwd: tmpdir(), text: "hello" }))).error).toBe("The folder isn't in any island.");
  expect((await json(await c.action("owned.start", { cwd: ws, text: " " }))).error).toBe("Message missing.");
  expect((await json(await c.action("owned.start", { cwd: ws, text: "x", model: "gpt" }))).error).toBe("Unknown model.");

  const res = await json(await c.action("owned.start", { cwd: ws, text: "Write notiz.md", model: "haiku" }));
  const id = res.data.id as string;
  const call = replay.calls[0]!;
  expect(call.cmd).toEqual([
    "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--permission-prompt-tool", "stdio", "--session-id", id, "--append-system-prompt", TITLE_PROMPT, "--model", "haiku",
  ]);
  expect(call.cwd).toBe(ws);
  expect(call.env?.ANTHROPIC_API_KEY).toBeUndefined();
  expect(call.env?.PATH).toBe(process.env.PATH);
  expect(JSON.parse(call.writes[0]!)).toEqual({ type: "user", message: { role: "user", content: "Write notiz.md" } });

  // the hook reports the same session: one session, with the control entity related to it
  await c.hook({ session_id: id, hook_event_name: "SessionStart", cwd: ws });
  const s = await c.session(id);
  expect(s?.related).toContain(`control:owned/${id}`);
  expect((await control(id))?.related).toContain(`session:claude/${id}`);
});

test("Permission: the question shows as attention, Allow sends the answer to Claude", async () => {
  const id = (await c.state()).entities.find((e) => e.kind === "control")!.data.id as string;
  const asking = await until(() => control(id), (e) => e?.status === "permission");
  expect(asking?.attention).toEqual({ level: "waiting", text: "Asks: Write" });
  expect((asking?.data.permission as any).description).toBe("notiz.md");
  expect(asking?.actions).toContain("owned.answer");

  expect((await c.action("owned.answer", { id, allow: true })).status).toBe(200);
  const answer = JSON.parse(replay.calls[0]!.writes[1]!);
  expect(answer.type).toBe("control_response");
  expect(answer.response.response.behavior).toBe("allow");
  const done = await until(() => control(id), (e) => e?.status === "idle");
  expect(done?.data.lastText).toBe("fertig");
  expect(done?.attention).toBeNull();
  expect((await json(await c.action("owned.answer", { id, allow: true }))).error).toBe("Nothing is waiting for an answer.");
});

test("Messages during a turn wait until it ends", async () => {
  const id = (await c.state()).entities.find((e) => e.kind === "control")!.data.id as string;
  await c.action("owned.send", { id, text: "Reply only with: zwei" });
  await c.action("owned.send", { id, text: "and one more" });
  const call = replay.calls[0]!;
  expect(call.writes.length).toBe(3); // the second one waits in the queue
  expect((await control(id))?.data.queued).toBe(1);
  await until(() => control(id), (e) => e?.data.lastText === "zwei");
  await until(async () => call.writes.length, (n) => n === 4);
  expect(JSON.parse(call.writes[3]!).message.content).toBe("and one more");
});

test("After a restart: marked interrupted, the next message resumes the session", async () => {
  const id = (await c.state()).entities.find((e) => e.kind === "control")!.data.id as string;
  orbit.stop(); // the last message never got an answer: the session was mid-turn
  orbit = await start();
  expect((await control(id))?.status).toBe("interrupted");
  await c.action("owned.send", { id, text: "What was my first message?" });
  const call = replay.calls[1]!;
  expect(call.cmd).toContain("--resume");
  expect(call.cmd).not.toContain("--session-id");
  await until(() => control(id), (e) => e?.status === "idle");
});

test("Take over asks first, then resumes the observed session", async () => {
  await c.hook({ session_id: "observed", hook_event_name: "SessionStart", cwd: ws });
  expect((await c.action("owned.takeover", { id: "observed", cwd: ws })).status).toBe(428);
  expect((await c.action("owned.takeover", { id: "observed", cwd: ws }, true)).status).toBe(200);
  expect((await control("observed"))?.data.takenOver).toBe(true);
  expect((await json(await c.action("owned.takeover", { id: "observed", cwd: ws }, true))).error).toBe("Already runs in Orbit.");
});

test("Own worktree on request: branch feat/<name> from the first message, removal only without changes", async () => {
  const res = await json(await c.action("owned.start", { cwd: ws, text: "Fix the login form, please", worktree: true }));
  const id = res.data.id as string;
  const wt = join(ws, ".worktrees", "fix-the-login-form");
  expect(git.at(-1)).toEqual(["git", "-C", ws, "worktree", "add", "-b", "feat/fix-the-login-form", wt]);
  expect(replay.calls.at(-1)?.cwd).toBe(wt); // the session runs inside its worktree
  const ctl = await until(() => control(id), (e) => e?.status === "idle");
  expect(ctl?.data.worktree).toBe(wt);
  expect(ctl?.actions).toContain("owned.removeWorktree");

  // irreversible: asks first; with changes git refuses and so do we
  expect((await c.action("owned.removeWorktree", { id })).status).toBe(428);
  expect((await json(await c.action("owned.removeWorktree", { id }, true))).error).toBe("The worktree has uncommitted changes. Nothing removed.");
  expect((await c.action("owned.removeWorktree", { id }, true)).status).toBe(200);
  expect(git.at(-1)).toEqual(["git", "-C", ws, "worktree", "remove", wt]); // never --force
  expect((await control(id))?.data.worktree).toBe(null);
});

test("Mode: passed as --permission-mode; Orbit does not offer bypassPermissions", async () => {
  const { claudeArgs } = await import("../src/sources/owned/session");
  expect(claudeArgs("claude", { id: "x", cwd: ws, model: null, effort: null, mode: "plan" }, false).slice(-2)).toEqual(["--permission-mode", "plan"]);
  expect(claudeArgs("claude", { id: "x", cwd: ws, model: null, effort: null, mode: null }, false)).not.toContain("--permission-mode");
  expect((await json(await c.action("owned.start", { cwd: ws, text: "x", mode: "bypassPermissions" }))).error).toBe("Unknown mode.");
  const id = (await c.state()).entities.find((e) => e.kind === "control")!.data.id as string;
  expect((await c.action("owned.configure", { id, mode: "acceptEdits" })).status).toBe(200);
  expect((await control(id))?.data.mode).toBe("acceptEdits");
});

test("Attachments: images go to Claude as images, other files are stored safely and named by path", async () => {
  const png = Buffer.from("fake-png").toString("base64");
  const pdf = Buffer.from("%PDF-1.4 report").toString("base64");
  const res = await json(await c.action("owned.start", {
    cwd: ws, text: "Have a look at this",
    attachments: [{ name: "screen.png", type: "image/png", data: png }, { name: "../../etc/report.pdf", type: "application/pdf", data: pdf }],
  }));
  const id = res.data.id as string;
  const msg = JSON.parse(replay.calls.at(-1)!.writes[0]!).message;
  expect(msg.content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png } });
  const stored = join(home, "attachments", id, "report.pdf"); // path parts stripped: never outside its folder
  expect(msg.content[1]).toEqual({ type: "text", text: `Have a look at this\n\nAttached file: ${stored}` });
  expect(readFileSync(stored, "utf8")).toBe("%PDF-1.4 report");

  const big = "A".repeat(Math.ceil((10 * 1024 * 1024 + 10) / 0.75));
  expect((await json(await c.action("owned.send", { id, text: "x", attachments: [{ name: "big.bin", type: "application/octet-stream", data: big }] }))).error)
    .toBe("“big.bin” is larger than 10 MB.");
  // the event log keeps that a file was sent, not its contents
  const { shorten } = await import("../src/core/actions");
  const cut = shorten({ attachments: [{ name: "a.png", data: big }] }) as any;
  expect(cut.attachments[0].name).toBe("a.png");
  expect(cut.attachments[0].data.length).toBeLessThan(300);
  expect(cut.attachments[0].data).toEndWith(`[${big.length} characters]`);
});

test("The first reply's title line does not show as the last message (ADR-0032, real recording)", () => {
  let s = initialRun();
  for (const line of streamFixture("titled")) s = applyLine(s, line).state;
  expect(s.lastText).toStartWith("Ein **Git-Rebase**");
  expect(s.lastText).not.toContain("[Titel:");
});
