// ADR-0028: questions and plans of owned sessions are answered on the board. Played against streams recorded from
// the real CLI (2026-11-23), never the CLI itself.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { applyLine, initialRun, type RunState } from "../src/sources/owned/stream";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-owned-ask-")));
const ws = join(home, "work");
const port = 47990 + Math.floor(Math.random() * 9);
const replay = replaySpawner(streamFixture("ask-question"), streamFixture("plan-approve"));
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
const json = async (r: Response) => (await r.json()) as any;
const control = async (id: string) => c.entity(`control:owned/${id}`);
async function until<T>(f: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await f();
    if (ok(v)) return v;
    await Bun.sleep(5);
  }
  throw new Error("timed out");
}

/** the state when the CLI asks */
function asking(fixture: string): RunState {
  let s = initialRun();
  for (const line of streamFixture(fixture)) {
    s = applyLine(s, line).state;
    if (s.permission) return s;
  }
  throw new Error("no question");
}

beforeAll(async () => {
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }]));
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, spawn: replay.spawn, run: async () => ({ code: 0, stdout: "", stderr: "" }) });
});
afterAll(() => orbit.stop());

test("Stream: AskUserQuestion is a question with questions and options (recorded in German)", () => {
  const p = asking("ask-question").permission!;
  expect(p.kind).toBe("question");
  expect(p.questions).toEqual([
    { question: "Welche Farbe?", header: "Farbe", multiSelect: false, options: [{ label: "Rot", description: "Die Farbe Rot" }, { label: "Blau", description: "Die Farbe Blau" }] },
  ]);
});

test("Stream: ExitPlanMode is a plan; its text comes from the Write into .claude/plans", () => {
  const p = asking("plan-approve").permission!;
  expect(p.kind).toBe("plan");
  expect(p.plan).toStartWith("# Context\nUser wants a simple file `hello.txt`");
});

test("Answering a question: the chosen option goes to Claude as answers", async () => {
  const id = (await json(await c.action("owned.start", { cwd: ws, text: "Ask me for a colour" }))).data.id as string;
  const q = await until(() => control(id), (e) => e?.status === "permission");
  expect(q?.attention).toEqual({ level: "waiting", text: "Asks: Welche Farbe?" });
  expect((q?.data.permission as any).kind).toBe("question");

  expect((await json(await c.action("owned.answer", { id, allow: true, answers: { "Welche Farbe?": 3 } }))).error).toBe("Answers must be text.");
  expect((await json(await c.action("owned.answer", { id, allow: true }))).error).toBe("Choose an answer.");
  expect((await c.action("owned.answer", { id, allow: true, answers: { "Welche Farbe?": "Blau" } })).status).toBe(200);
  const answer = JSON.parse(replay.calls[0]!.writes[1]!);
  expect(answer.response.response).toEqual({
    behavior: "allow",
    updatedInput: { questions: (q?.data.permission as any).questions.map((x: any) => ({ ...x })), answers: { "Welche Farbe?": "Blau" } },
  });
  const done = await until(() => control(id), (e) => e?.status === "idle");
  expect(done?.data.lastText).toBe("Du hast **Blau** gewählt!");
});

test("Approving a plan: the approval goes to Claude as allow, the plan text is on the entity", async () => {
  const id = (await json(await c.action("owned.start", { cwd: ws, text: "Plan hello.txt", mode: "plan" }))).data.id as string;
  const q = await until(() => control(id), (e) => e?.status === "permission");
  expect(q?.attention).toEqual({ level: "waiting", text: "Plan to approve" });
  expect((q?.data.permission as any).plan).toContain("Create `hello.txt`");
  expect((await c.action("owned.answer", { id, allow: true })).status).toBe(200);
  expect(JSON.parse(replay.calls[1]!.writes[1]!).response.response.behavior).toBe("allow");
});
