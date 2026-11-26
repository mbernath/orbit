// Agents (ADR-0015, ADR-0016, ADR-0020): trigger read once, memory file pinned, runs through owned.start.
// Claude Code is stubbed twice: the trigger reader through `run`, the runs through `spawn` (recorded stream).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/core/types";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-agents-")));
const ws = join(home, "shop");
const port = 48500 + Math.floor(Math.random() * 90);
const replay = replaySpawner(...Array.from({ length: 6 }, () => streamFixture("simple")));
const readerCalls: string[][] = [];
// trigger reader: answers like `claude -p --output-format json` would
const run: Runner = async (cmd) => {
  if (!cmd.includes("--output-format")) return { code: 1, stdout: "", stderr: "" }; // git ls-files etc.
  readerCalls.push(cmd);
  const text = cmd.at(-1) ?? "";
  const answer = /is done/.test(text)
    ? { kind: "event", type: "session.done" }
    : /weekdays/.test(text)
      ? { kind: "schedule", schedule: { every: "weekday", at: "09:00" } }
      : { understood: false };
  return { code: 0, stdout: JSON.stringify({ type: "result", result: "```json\n" + JSON.stringify(answer) + "\n```" }), stderr: "" };
};

let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
const json = async (r: Response) => (await r.json()) as any;
const agent = async (id: string) => c.entity(`agent:agents/${id}`);
const create = async (name: string, trigger: string) =>
  json(await c.action("agents.create", { workspaceId: "shop", name, role: `${name} maintains the shop.`, trigger }));

beforeAll(async () => {
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "shop", name: "Shop", paths: [ws] }]));
  orbit = await createOrbit({
    home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, agentsTickMs: 0, run, spawn: replay.spawn,
  });
});
afterAll(() => orbit.stop());

// "Aufräumer" stays German on purpose: it exercises the umlaut slug (aufraeumer.md).
test("Create: the trigger is read once and read back, the memory is a document in the island", async () => {
  const res = await create("Aufräumer", "when a session is done");
  expect(res.data.reading).toBe("Runs: when a session is done");
  expect(readerCalls[0]?.slice(0, 5)).toEqual(["env", "-u", "ANTHROPIC_API_KEY", "-u", "ANTHROPIC_AUTH_TOKEN"]);
  expect(readerCalls[0]).toContain("haiku");

  const a = (await agent(res.data.id))!;
  expect(a.data).toMatchObject({ understood: true, model: "sonnet", effort: "low" });
  const memory = join(ws, ".orbit", "agents", "aufraeumer.md");
  expect(a.data.memoryPath).toBe(memory);
  expect(readFileSync(memory, "utf8")).toStartWith("# Aufräumer\n\nAufräumer maintains the shop.");
  expect((await c.state()).entities.some((e) => e.kind === "file" && e.data.path === memory)).toBe(true);

  expect((await json(await c.action("agents.create", { workspaceId: "shop", name: "aufräumer", role: "x" }))).error).toBe("An agent with this name already exists.");
  const odd = await create("Moonwatcher", "at every phase of the moon");
  expect(odd.data.reading).toBe("Trigger not understood: runs only when you start it.");
  expect((await agent(odd.data.id))?.data.understood).toBe(false);
});

test("An event starts a run with role, memory and cause; no second one while it runs; its own end triggers nothing", async () => {
  const id = (await c.state()).entities.find((e) => e.kind === "agent" && e.title === "Aufräumer")!.data.id as string;
  await c.hook({ session_id: "other", hook_event_name: "SessionStart", cwd: ws });
  await c.hook({ session_id: "other", hook_event_name: "Stop", cwd: ws, last_assistant_message: "done" });
  await Bun.sleep(20);
  expect(replay.calls.length).toBe(1);
  const call = replay.calls[0]!;
  expect(call.cwd).toBe(ws);
  const prompt = JSON.parse(call.writes[0]!).message.content as string;
  expect(prompt).toContain("You are the agent “Aufräumer”");
  expect(prompt).toContain(join(ws, ".orbit", "agents", "aufraeumer.md"));
  expect(prompt).toContain("Why this run started: Session other is done");

  const a = (await agent(id))!;
  expect(a.status).toBe("running");
  const runId = (a.data.runs as any[])[0].sessionId as string;
  const ctl = await c.entity(`control:owned/${runId}`);
  expect(ctl?.related).toContain(`agent:agents/${id}`); // the run belongs to its agent

  // another trigger while it runs: skipped, not piled up
  await c.hook({ session_id: "other2", hook_event_name: "Stop", cwd: ws, last_assistant_message: "done" });
  await Bun.sleep(20);
  expect(replay.calls.length).toBe(1);
  // the run itself finishes: frees the agent, but does not start it again
  await c.hook({ session_id: runId, hook_event_name: "Stop", cwd: ws, last_assistant_message: "finished" });
  await Bun.sleep(20);
  expect(replay.calls.length).toBe(1);
  expect((await agent(id))?.status).toBe("idle");
});

test("Schedule: weekdays at 9 runs once when due, not once per missed hour", async () => {
  const res = await create("Morning report", "weekdays at 9 am");
  expect(res.data.reading).toBe("Runs: weekdays at 09:00");
  const a = (await agent(res.data.id))!;
  const due = a.data.nextRunAt as number;
  const before = replay.calls.length;
  await orbit.tickAgents(due - 60_000);
  expect(replay.calls.length).toBe(before);
  await orbit.tickAgents(due + 3 * 3600_000); // Orbit was off for hours: one run
  await orbit.tickAgents(due + 3 * 3600_000 + 30_000);
  expect(replay.calls.length).toBe(before + 1);
  expect(JSON.parse(replay.calls.at(-1)!.writes[0]!).message.content).toContain("Why this run started: Runs: weekdays at 09:00");
});

test("Run now starts by hand; delete asks first and leaves the memory in place", async () => {
  const id = (await c.state()).entities.find((e) => e.kind === "agent" && e.title === "Moonwatcher")!.data.id as string;
  const before = replay.calls.length;
  expect((await c.action("agents.run", { id })).status).toBe(200);
  expect(replay.calls.length).toBe(before + 1);
  expect((await c.action("agents.run", { id })).status).toBe(409); // still running

  expect((await c.action("agents.delete", { id })).status).toBe(428);
  expect((await c.action("agents.delete", { id }, true)).status).toBe(200);
  expect(await agent(id)).toBeUndefined();
  expect(existsSync(join(ws, ".orbit", "agents", "moonwatcher.md"))).toBe(true);
});
