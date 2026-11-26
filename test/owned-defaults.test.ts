// Run defaults per island (ADR-0025): set for the island, else Claude's settings. Own Claude folder, never the real one.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { claudeDefaults } from "../src/sources/owned/defaults";
import { BOARD_TOKEN, client, replaySpawner, streamFixture } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-owned-defaults-")));
const claudeHome = join(home, "claude");
const ws = join(home, "work");
const other = join(home, "other");
const port = 47990 + Math.floor(Math.random() * 9);
const replay = replaySpawner(streamFixture("simple"), streamFixture("simple"), streamFixture("simple"));
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
const json = async (r: Response) => (await r.json()) as any;
const write = (file: string, v: unknown) => (mkdirSync(join(file, ".."), { recursive: true }), writeFileSync(file, JSON.stringify(v)));
const lastCmd = () => replay.calls.at(-1)!.cmd;
const flag = (cmd: string[], name: string) => (cmd.includes(name) ? cmd[cmd.indexOf(name) + 1] : undefined);

beforeAll(async () => {
  mkdirSync(ws, { recursive: true });
  mkdirSync(other, { recursive: true });
  write(join(claudeHome, "settings.json"), { model: "opus[1m]", effortLevel: "medium", permissions: { defaultMode: "acceptEdits" } });
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }, { id: "other", name: "Other", paths: [other] }]));
  orbit = await createOrbit({
    home, port, claudeProjects: join(home, "none"), claudeHome, github: false, boardToken: BOARD_TOKEN, filesPollMs: 0, spawn: replay.spawn,
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
  });
});
afterAll(() => orbit.stop());

test("Claude's settings: local before project before user; bypassPermissions reads as \"always asks\"", () => {
  const dir = join(home, "proj");
  write(join(dir, ".claude", "settings.json"), { model: "sonnet", effortLevel: "high" });
  write(join(dir, ".claude", "settings.local.json"), { effortLevel: "low" });
  expect(claudeDefaults(dir, claudeHome)).toEqual({ model: "sonnet", effort: "low", mode: "acceptEdits" });
  write(join(dir, ".claude", "settings.local.json"), { permissions: { defaultMode: "bypassPermissions" } });
  expect(claudeDefaults(dir, claudeHome).mode).toBe("default");
  expect(claudeDefaults(join(home, "nowhere"), join(home, "nowhere"))).toEqual({ model: null, effort: null, mode: null });
});

test("Without an island default: the board sees Claude's values, the CLI reads them itself (no flags)", async () => {
  const d = await c.entity("defaults:owned/acme");
  expect(d?.data).toEqual({ set: { model: null, effort: null, mode: null }, claude: { model: "opus[1m]", effort: "medium", mode: "acceptEdits" } });
  const id = (await json(await c.action("owned.start", { cwd: ws, text: "x" }))).data.id;
  for (const f of ["--model", "--effort", "--permission-mode"]) expect(lastCmd()).not.toContain(f);
  expect((await c.entity(`control:owned/${id}`))?.data.defaults).toEqual({ model: "opus[1m]", effort: "medium", mode: "acceptEdits" });
});

test("Island default set: applies to new sessions of that island and goes to the CLI as a flag, other islands stay with Claude", async () => {
  expect((await json(await c.action("owned.setDefaults", { workspaceId: "acme", model: "gpt" }))).error).toBe("Unknown model.");
  expect((await json(await c.action("owned.setDefaults", { workspaceId: "nope" }))).error).toBe("Island not found.");
  expect((await c.action("owned.setDefaults", { workspaceId: "acme", model: "haiku", effort: "low" })).status).toBe(200);
  expect((await c.entity("defaults:owned/acme"))?.data.set).toEqual({ model: "haiku", effort: "low", mode: null });

  const id = (await json(await c.action("owned.start", { cwd: ws, text: "x" }))).data.id;
  expect([flag(lastCmd(), "--model"), flag(lastCmd(), "--effort"), flag(lastCmd(), "--permission-mode")]).toEqual(["haiku", "low", undefined]);
  expect((await c.entity(`control:owned/${id}`))?.data.defaults).toEqual({ model: "haiku", effort: "low", mode: "acceptEdits" });

  await c.action("owned.start", { cwd: other, text: "x", effort: "high" }); // the session's own choice wins
  expect([flag(lastCmd(), "--model"), flag(lastCmd(), "--effort")]).toEqual([undefined, "high"]);
});
