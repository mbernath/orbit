// Changing model, effort or mode of an owned session while its process is busy (ADR-0017, ADR-0019).
// Played against recorded streams, never the real CLI.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-owned-configure-")));
const ws = join(home, "work");
const port = 47900 + Math.floor(Math.random() * 90);
const replay = replaySpawner(streamFixture("permission-allow-two-turns"), streamFixture("resume"));
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

beforeAll(async () => {
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }]));
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, spawn: replay.spawn, run: async () => ({ code: 0, stdout: "", stderr: "" }) });
});
afterAll(() => orbit.stop());

test("Mode changed during a running turn: applies from the next message, not only after Orbit restarts", async () => {
  const id = (await json(await c.action("owned.start", { cwd: ws, text: "Write notiz.md" }))).data.id as string;
  await until(() => control(id), (e) => e?.status === "permission");
  expect((await c.action("owned.configure", { id, mode: "auto" })).status).toBe(200);
  expect(replay.calls[0]!.ended).toBe(false); // mid-turn: the process keeps working

  expect((await c.action("owned.answer", { id, allow: true })).status).toBe(200);
  await until(async () => replay.calls[0]!.ended, (v) => v); // turn over: the old process ends

  expect((await c.action("owned.send", { id, text: "continue" })).status).toBe(200);
  await until(async () => replay.calls.length, (n) => n === 2);
  expect(replay.calls[1]!.cmd).toContain("--resume");
  expect(replay.calls[1]!.cmd.slice(-2)).toEqual(["--permission-mode", "auto"]);
});
