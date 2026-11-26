// Stop for owned sessions (ADR-0044): the running turn is interrupted, the process and the session stay; what the
// turn does is a short activity line. Played against a recording of the real CLI (interrupt.jsonl).
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { createOwnedSession } from "../src/sources/owned/session";
import { activityOf, applyLine, initialRun, type RunState } from "../src/sources/owned/stream";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const spec = { id: "7d5f9ad4-0000-4000-8000-000000000044", cwd: "/fixture/ws", model: null, effort: null };
const session = (recording: string[]) => {
  const replay = replaySpawner(recording);
  const s = createOwnedSession(spec, { spawn: replay.spawn, bin: "claude", env: {}, resume: false, onChange: () => {} });
  return { s, calls: replay.calls };
};
async function until(ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(5);
  expect(ok()).toBe(true);
}

test("Activity: the stream says what the turn does; nothing between turns", () => {
  let s: RunState = initialRun();
  const seen: (string | null | undefined)[] = [];
  for (const line of streamFixture("interrupt")) {
    s = applyLine(s, line).state;
    if (seen.at(-1) !== s.activity) seen.push(s.activity);
  }
  expect(seen).toEqual([null, "Running sleep 30", "Thinking", null, "Thinking", "Writing", null]);
  expect(activityOf({ type: "tool_use", name: "Read", input: { file_path: "/a/b/stream.ts" } })).toBe("Reading stream.ts");
  expect(activityOf({ type: "tool_use", name: "Edit", input: { file_path: "web/x.js" } })).toBe("Editing x.js");
  expect(activityOf({ type: "tool_use", name: "mcp__x__y", input: {} })).toBe("Using mcp__x__y");
  expect(activityOf({ type: "text", text: "  " })).toBeNull();
});

test("Stop interrupts the turn: no error, queue dropped and returned, the same process takes the next message", async () => {
  const { s, calls } = session(streamFixture("interrupt"));
  s.send("Run sleep 30");
  await until(() => s.state.activity === "Thinking");
  expect(s.since).toBeNumber();
  s.send("queued one");
  expect(s.queued).toBe(1);
  const dropped = await s.interrupt();
  expect(dropped).toEqual(["queued one"]);
  expect(JSON.parse(calls[0]!.writes[1]!)).toMatchObject({ type: "control_request", request: { subtype: "interrupt" } });
  expect(s.state).toMatchObject({ status: "idle", error: null, activity: null });
  expect(s.since).toBeNull();
  expect(s.running).toBe(true);
  s.send("Say only: hi");
  await until(() => s.state.lastText === "hi" && s.state.status === "idle");
  expect(calls.length).toBe(1);
  expect(calls[0]!.ended).toBe(false);
});

test("Stop falls back to ending the process when the CLI does not end the turn in time; still no error", async () => {
  const { s, calls } = session(streamFixture("interrupt").slice(0, 7)); // the CLI never answers the interrupt
  s.send("Run sleep 30");
  await until(() => s.state.activity === "Thinking");
  expect(await s.interrupt(20)).toEqual([]);
  expect(calls[0]!.ended).toBe(true);
  expect(s.state).toMatchObject({ status: "idle", error: null });
  expect(s.running).toBe(false);
});

test("Stop without a running turn only drops nothing and writes nothing", async () => {
  const { s, calls } = session(streamFixture("simple"));
  expect(await s.interrupt()).toEqual([]);
  expect(calls.length).toBe(0);
});

test("owned.stop through the server: the turn ends, the queue comes back, the session reads idle without a Stop hook", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-stop-")));
  const ws = join(home, "work");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }]));
  const port = 47860 + Math.floor(Math.random() * 100);
  const replay = replaySpawner(streamFixture("interrupt"));
  const run = async () => ({ code: 1, stdout: "", stderr: "" });
  const orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, spawn: replay.spawn, run });
  try {
    const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
    const id = ((await (await c.action("owned.start", { cwd: ws, text: "Run sleep 30" })).json()) as any).data.id as string;
    await c.hook({ session_id: id, hook_event_name: "UserPromptSubmit", cwd: ws, prompt: "Run sleep 30" });
    const ctl = async () => c.entity(`control:owned/${id}`);
    for (let i = 0; i < 200 && (await ctl())?.data.activity !== "Thinking"; i++) await Bun.sleep(5);
    expect((await ctl())?.data).toMatchObject({ activity: "Thinking", since: expect.any(Number) });
    await c.action("owned.send", { id, text: "later" });
    const res = (await (await c.action("owned.stop", { id })).json()) as any;
    expect(res.data).toEqual({ dropped: ["later"] });
    expect(await ctl()).toMatchObject({ status: "idle", attention: null, data: { activity: null, since: null, queued: 0, running: true } });
    expect((await c.session(id))?.status).toBe("idle");
  } finally {
    await orbit.stop();
  }
});
