// Core: security of the local server, action layer, SSE and migration of pre-refactoring databases.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client } from "./helpers";

const home = mkdtempSync(join(tmpdir(), "orbit-core-"));
const port = 48600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(base, () => orbit.hookToken);

// A database as written by the version before the foundation refactoring.
function writeLegacyDatabase() {
  const db = new Database(join(home, "orbit.db"));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, git_root TEXT, branch TEXT, status TEXT NOT NULL DEFAULT 'idle',
      title TEXT, last_message TEXT, transcript_path TEXT, acknowledged INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ai_title TEXT, custom_title TEXT,
      pos_x REAL, pos_y REAL, archived_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, type TEXT, payload TEXT, at INTEGER NOT NULL);
    CREATE TABLE imported_files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);
    INSERT INTO sessions (id, cwd, status, title, custom_title, started_at, updated_at, pos_x, pos_y)
      VALUES ('placed', '/w', 'history', 'Old', 'My title', 1, 2, 10, 20);
    INSERT INTO sessions (id, cwd, status, started_at, updated_at, archived_at) VALUES ('gone', '/w', 'ended', 1, 2, 3);
    INSERT INTO sessions (id, cwd, status, started_at, updated_at) VALUES ('plain', '/w', 'working', 1, 2);
    INSERT INTO events (session_id, type, payload, at) VALUES ('plain', 'Stop', '{}', 5);
  `);
  db.close();
}

beforeAll(async () => {
  writeLegacyDatabase();
  writeFileSync(join(home, "workspaces.json"), "[]");
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN });
});
afterAll(() => orbit.stop());

test("An old database is taken over: positions and archive move into elements", async () => {
  const st = await c.state();
  const placed = st.entities.find((e) => e.ref === "session:claude/placed")!;
  expect(placed.title).toBe("My title");
  expect(placed.status).toBe("inactive");
  expect((await c.session("gone"))!.status).toBe("inactive");
  expect((await c.session("plain"))!.status).toBe("working");
  expect(await c.element("session:claude/placed")).toMatchObject({ x: 10, y: 20, archived: false });
  expect(await c.element("session:claude/gone")).toMatchObject({ x: null, archived: true });
  expect(await c.element("session:claude/plain")).toBeUndefined();

  const cols = (orbit.db.query(`PRAGMA table_info(claude_sessions)`).all() as { name: string }[]).map((x) => x.name);
  expect(cols).not.toContain("pos_x");
  const moved = orbit.db.query(`SELECT source, type, ref FROM event_log WHERE type = 'hook.Stop'`).get();
  expect(moved).toEqual({ source: "claude", type: "hook.Stop", ref: "session:claude/plain" });
});

test("Migrations run exactly once", async () => {
  const versions = orbit.db.query(`SELECT source, version FROM schema_migrations ORDER BY source`).all();
  expect(versions).toEqual([
    { source: "agents", version: 1 },
    { source: "canvas", version: 1 },
    { source: "claude", version: 6 },
    { source: "core", version: 1 },
    { source: "files", version: 1 },
    { source: "lists", version: 1 },
    { source: "owned", version: 5 },
  ]);
});

test("Writing requests need the board token", async () => {
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/api/actions/claude.import`, { method: "POST", headers, body: JSON.stringify({}) });
  expect((await post({})).status).toBe(401);
  expect((await post({ "X-Orbit-Token": "wrong" })).status).toBe(401);
  expect((await post({ "X-Orbit-Token": BOARD_TOKEN })).status).toBe(200);
});

test("A foreign origin and a foreign host are rejected", async () => {
  const res = await fetch(`${base}/api/actions/claude.import`, {
    method: "POST",
    headers: { "X-Orbit-Token": BOARD_TOKEN, Origin: "https://evil.example" },
    body: "{}",
  });
  expect(res.status).toBe(403);
  const own = await fetch(`${base}/api/actions/claude.import`, {
    method: "POST",
    headers: { "X-Orbit-Token": BOARD_TOKEN, Origin: base },
    body: "{}",
  });
  expect(own.status).toBe(200);
  // DNS rebinding: a foreign name resolving to 127.0.0.1 must not even read the state.
  expect((await fetch(`${base}/api/state`, { headers: { Host: "evil.example" } })).status).toBe(421);
});

test("The hook needs the hook token", async () => {
  const body = JSON.stringify({ session_id: "h", hook_event_name: "SessionStart", cwd: "/w" });
  expect((await fetch(`${base}/events`, { method: "POST", body })).status).toBe(401);
  expect((await fetch(`${base}/events`, { method: "POST", headers: { "X-Orbit-Token": BOARD_TOKEN }, body })).status).toBe(401);
  expect((await c.hook(JSON.parse(body))).status).toBe(204);
});

test("Actions are logged; unknown and unconfirmed ones are rejected", async () => {
  await c.action("claude.rename", { id: "plain", title: "Logged" });
  const row = orbit.db.query(`SELECT payload FROM event_log WHERE type = 'action' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  expect(JSON.parse(row.payload)).toMatchObject({ id: "claude.rename", actor: "board", ok: true });
  expect((await c.action("does.not.exist")).status).toBe(404);
});

test("Irreversible actions need confirmation", async () => {
  const { createActions } = await import("../src/core/actions");
  const actions = createActions(() => {});
  let ran = false;
  actions.register([{ id: "x.danger", risk: "irreversible", allowedActors: ["board"], run: () => ((ran = true), { ok: true }) }]);
  expect(await actions.execute("x.danger", {}, "board")).toMatchObject({ ok: false, status: 428 });
  expect(await actions.execute("x.danger", {}, "agent", true)).toMatchObject({ ok: false, status: 403 });
  expect(ran).toBe(false);
  expect(await actions.execute("x.danger", {}, "board", true)).toMatchObject({ ok: true });
  expect(ran).toBe(true);
});

test("Islands: frames are stored, must not overlap and take their content along", async () => {
  const ok = await c.action("canvas.frame", { ws: "a", x: 0, y: 0, w: 400, h: 300 });
  expect(ok.status).toBe(200);
  expect(await c.element("frame:a")).toMatchObject({ ref: "frame:core/a", x: 0, y: 0, w: 400, h: 300 });

  // overlapping (incl. the 28-unit gap) is rejected, the stored frame stays
  const clash = await c.action("canvas.frame", { ws: "b", x: 410, y: 0, w: 300, h: 300 });
  expect(clash.status).toBe(400);
  expect((await clash.json()).error).toBe("Islands must not overlap.");
  expect(await c.element("frame:b")).toBeUndefined();

  // moving a frame moves the given elements in the same step
  await c.action("canvas.frame", { ws: "a", x: 100, y: 50, w: 400, h: 300, moves: [{ ref: "session:claude/plain", x: 160, y: 120 }] });
  expect(await c.element("frame:a")).toMatchObject({ x: 100, y: 50 });
  expect(await c.element("session:claude/plain")).toMatchObject({ x: 160, y: 120 });

  expect((await c.action("canvas.frame", { ws: "a", x: 0, y: 0, w: 50, h: 50 })).status).toBe(400); // too small

  // several frames at once, all or nothing
  const both = await c.action("canvas.frame", { frames: [{ ws: "c", x: 2000, y: 0, w: 300, h: 200 }, { ws: "d", x: 2400, y: 0, w: 300, h: 200 }] });
  expect(both.status).toBe(200);
  expect(await c.element("frame:d")).toMatchObject({ x: 2400 });
  const clashInBatch = await c.action("canvas.frame", { frames: [{ ws: "e", x: 4000, y: 0, w: 300, h: 200 }, { ws: "f", x: 4100, y: 0, w: 300, h: 200 }] });
  expect(clashInBatch.status).toBe(400);
  expect(await c.element("frame:e")).toBeUndefined();
});

test("SSE reports changes", async () => {
  const res = await fetch(`${base}/api/stream`);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  expect(await read()).toContain("event: change"); // initial
  await c.hook({ session_id: "sse", hook_event_name: "SessionStart", cwd: "/w" });
  expect(await read()).toContain("event: change");
  await reader.cancel();
});

test("Board files are never taken stale from the browser cache", async () => {
  for (const path of ["/js/main.js", "/style.css"]) {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  }
});

test("The board can be installed as a standalone app", async () => {
  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain('rel="manifest" href="/manifest.json"');
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) expect((await fetch(`${base}${icon.src}`)).status).toBe(200);
});
