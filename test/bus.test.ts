// ADR-0020: sources publish domain events and run each other's actions through the core, never directly.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../src/core/core";
import { defaultRunner, defaultSpawner } from "../src/core/runner";
import type { CoreContext, CoreEvent, Source } from "../src/core/types";

const done: string[] = [];
let a: CoreContext;
let b: CoreContext;
const seen: CoreEvent[] = [];

// source "a" offers actions; source "b" reacts to events and calls them
const sourceA: Source = {
  id: "a",
  actions: [
    { id: "a.start", risk: "local", allowedActors: ["board", "system"], validate: (i: any) => (i?.what ? null : "What is missing."), run: (i: any) => (done.push(i.what), { ok: true }) },
    { id: "a.boardOnly", risk: "local", allowedActors: ["board"], run: () => ({ ok: true }) },
    { id: "a.merge", risk: "irreversible", allowedActors: ["board", "system"], run: () => (done.push("merged"), { ok: true }) },
  ],
  routes: [],
  start: (c) => void (a = c),
  entities: () => [],
};
const sourceB: Source = {
  id: "b",
  actions: [],
  routes: [],
  start(c) {
    b = c;
    c.on((e) => {
      seen.push(e);
      if (e.type === "pr.merged") void c.act("a.start", { what: `after #${e.number}` });
    });
    c.on(() => {
      throw new Error("a broken listener");
    });
  },
  entities: () => [],
};

let core: Awaited<ReturnType<typeof createCore>>;
beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "orbit-bus-"));
  core = await createCore({ home, port: 48300 + Math.floor(Math.random() * 200), run: defaultRunner, spawn: defaultSpawner, sources: [sourceA, sourceB] });
});
afterAll(() => core.stop());

test("An event reaches every source, even when a listener fails, and is logged", async () => {
  a.publish({ type: "pr.merged", repo: "acme/shop", number: 7, branch: "feat/x", base: "main", workspaceId: null });
  await Bun.sleep(5);
  expect(seen.map((e) => e.type)).toContain("pr.merged");
  expect(done).toEqual(["after #7"]); // b reacted by running a's action
  const logged = core.db.query(`SELECT source, type FROM event_log WHERE type LIKE 'event.%'`).all();
  expect(logged).toEqual([{ source: "core", type: "event.pr.merged" }]);
  const action = core.db.query(`SELECT payload FROM event_log WHERE type = 'action' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  expect(JSON.parse(action.payload)).toMatchObject({ id: "a.start", actor: "system", ok: true });
});

test("The system may only run local actions that explicitly allow it; checked as from the board", async () => {
  expect(await b.act("a.start", {})).toEqual({ ok: false, status: 400, error: "What is missing." });
  expect(await b.act("a.boardOnly", {})).toEqual({ ok: false, status: 403, error: "Action not allowed." });
  expect(await b.act("a.merge", {})).toEqual({ ok: false, status: 403, error: "Only you can trigger this." });
  expect(await b.act("does.not.exist", {})).toMatchObject({ ok: false, status: 404 });
  expect(done).not.toContain("merged");
});
