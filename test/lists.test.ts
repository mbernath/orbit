// Lists source (ADR-0036): contract parsing, pinning after a trial run, last good list on failure, refresh interval.
// Commands run through a stub runner; `/bin/sh` commands go to the real runner, so the demo script is exercised as is.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunner } from "../src/core/runner";
import type { Runner } from "../src/core/types";
import { derive, parseList } from "../src/sources/lists/contract";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client } from "./helpers";

const DEMO = join(import.meta.dir, "..", "scripts", "orbit-list-demo.sh");
const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-lists-")));
const port = 49200 + Math.floor(Math.random() * 300);
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);
const calls: { cmd: string[]; cwd?: string }[] = [];
let picked: { code: number; stdout: string; stderr: string } = { code: 0, stdout: "", stderr: "" };
const run: Runner = async (cmd, cwd) => {
  calls.push({ cmd, cwd });
  if (cmd[0] === "osascript") return picked;
  return defaultRunner(cmd, cwd);
};

beforeAll(async () => {
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [home] }]));
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, run, filesPollMs: 0, agentsTickMs: 0, listsTickMs: 0 });
});
afterAll(() => orbit.stop());

const body = async (r: Response) => (await r.json()) as any;

// ---------- contract (pure) ----------

test("Contract: only id and title are required, without sections there is one unnamed section", () => {
  const p = parseList(JSON.stringify({ version: 1, items: [{ id: 1, title: "A" }, { title: "no id" }] }), 0);
  expect(p.ok && p.list.sections).toEqual([
    { id: "_", title: "", collapsed: false, items: [{ id: "1", title: "A", state: "open", stateLabel: null, ref: null, url: null, note: null, badges: [], children: [] }] },
  ]);
});

test("Contract: order is kept, unknown sections go to the end, unknown values fall back to the default", () => {
  const p = parseList(JSON.stringify({
    version: 1,
    sections: [{ id: "b", title: "B" }, { id: "a", title: "A" }],
    items: [
      { id: "1", title: "one", section: "a", state: "weird", url: "javascript:alert(1)", badges: [{ text: "x", tone: "pink" }] },
      { id: "2", title: "two", section: "b" },
      { id: "3", title: "three", section: "zzz" },
    ],
  }), 0);
  if (!p.ok) throw new Error(p.error);
  expect(p.list.sections.map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([["b", ["2"]], ["a", ["1"]], ["_", ["3"]]]);
  expect(p.list.sections[1]!.items[0]).toMatchObject({ state: "open", url: null, badges: [{ text: "x", tone: "neutral" }] });
});

test("Contract: ref is a short label, numbers become text, anything too long is cut", () => {
  const p = parseList(JSON.stringify({
    version: 1,
    items: [{ id: "1", title: "A", ref: "#396", children: [{ id: "2", title: "B", ref: 7 }, { id: "3", title: "C", ref: "x".repeat(50) }] }],
  }), 0);
  if (!p.ok) throw new Error(p.error);
  const a = p.list.sections[0]!.items[0]!;
  expect([a.ref, ...a.children.map((c) => c.ref)]).toEqual(["#396", "7", "x".repeat(40)]);
});

test("Contract: the script's error, wrong version, no JSON", () => {
  expect(parseList(`{"version":1,"error":"gh not logged in"}`, 1)).toEqual({ ok: false, error: "gh not logged in" });
  expect(parseList(`{"version":2,"items":[]}`, 0).ok).toBe(false);
  expect(parseList(`hello`, 0)).toEqual({ ok: false, error: "The output is not JSON." });
  expect(parseList(`{"version":1,"items":[]}`, 3)).toEqual({ ok: false, error: "The script exited with code 3." });
});

test("Summary: open items per section (top level), blocked ones across all levels", () => {
  const p = parseList(JSON.stringify({
    version: 1,
    sections: [{ id: "now", title: "Now" }],
    items: [{ id: "1", title: "a", section: "now", children: [{ id: "2", title: "b", state: "blocked" }] }, { id: "3", title: "c", section: "now", state: "done" }],
  }), 0);
  if (!p.ok) throw new Error(p.error);
  expect(derive(p.list)).toEqual({ sections: [{ id: "now", title: "Now", open: 1 }], blocked: 1, total: 3 });
});

// ---------- source ----------

test("A trial run with the demo script shows what would be pinned, and stores nothing", async () => {
  const r = await c.action("lists.test", { workspaceId: "acme", command: DEMO });
  expect(r.status).toBe(200);
  expect((await body(r)).data).toMatchObject({ title: "Roadmap (demo)", blocked: 1, sections: [{ id: "now", open: 2 }, { id: "next", open: 2 }, { id: "later", open: 3 }] });
  expect((await c.state()).entities.filter((e) => e.kind === "list")).toEqual([]);
  const last = calls.at(-1)!;
  expect(last.cwd).toBe(home);
  expect(last.cmd.slice(0, 2)).toEqual(["/usr/bin/env", "ORBIT_LIST_VERSION=1"]);
});

test("Pinning fails when the run fails, with the script's message", async () => {
  const r = await c.action("lists.add", { workspaceId: "acme", command: `${DEMO} error` });
  expect(r.status).toBe(422);
  expect((await body(r)).error).toBe("Demo error: source not reachable");
  expect((await c.action("lists.add", { workspaceId: "nope", command: DEMO })).status).toBe(400);
});

test("A pinned list is an entity of the island; a failure keeps the last good list", async () => {
  const script = join(home, "list.sh");
  writeFileSync(script, `#!/bin/sh\necho '{"version":1,"items":[{"id":"1","title":"One"}]}'\n`, { mode: 0o755 });
  const r = await c.action("lists.add", { workspaceId: "acme", command: "./list.sh", title: "Todos", interval: 60 });
  const { ref, id } = (await body(r)).data;
  let e = await c.entity(ref);
  expect(e).toMatchObject({ kind: "list", title: "Todos", status: "ok", workspaceId: "acme", data: { interval: 60, error: null } });
  expect((e!.data as any).list.sections[0].items[0].title).toBe("One");

  writeFileSync(script, `#!/bin/sh\necho broken\nexit 2\n`, { mode: 0o755 });
  expect((await c.action("lists.refresh", { id })).status).toBe(422);
  e = await c.entity(ref);
  expect(e).toMatchObject({ status: "stale", data: { error: "The script exited with code 2." } });
  expect((e!.data as any).list.sections[0].items[0].title).toBe("One");

  // the interval: nothing is due right after the run, everything after 60 s
  writeFileSync(script, `#!/bin/sh\necho '{"version":1,"items":[{"id":"2","title":"Two"}]}'\n`, { mode: 0o755 });
  await orbit.tickLists(Date.now() + 1000);
  expect((await c.entity(ref))!.status).toBe("stale");
  await orbit.tickLists(Date.now() + 61_000);
  e = await c.entity(ref);
  expect(e).toMatchObject({ status: "ok", data: { error: null } });
  expect((e!.data as any).list.sections[0].items[0].title).toBe("Two");

  expect((await c.action("lists.update", { id, title: "", interval: 0 })).status).toBe(200);
  expect(await c.entity(ref)).toMatchObject({ title: "List", data: { interval: 0 } });
  expect((await c.action("lists.update", { id, interval: 42 })).status).toBe(400);

  expect((await c.action("lists.remove", { id })).status).toBe(200);
  expect(await c.entity(ref)).toBeUndefined();
});

test("The guide for script authors comes as Markdown from docs/list-contract.md", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/lists/guide`);
  expect(r.headers.get("content-type")).toContain("text/markdown");
  const text = await r.text();
  expect(text).toStartWith("# Writing a list script for Orbit");
  expect(text).toContain("ORBIT_LIST_VERSION=1");
});

test("Choosing a script returns a path inside the island as relative, cancelling is no error", async () => {
  picked = { code: 0, stdout: `${home}/scripts/my list.sh\n`, stderr: "" };
  expect((await body(await c.action("lists.pickScript", { workspaceId: "acme" }))).data).toEqual({ command: `'./scripts/my list.sh'` });
  picked = { code: 0, stdout: "/opt/todos\n", stderr: "" };
  expect((await body(await c.action("lists.pickScript", { workspaceId: "acme" }))).data).toEqual({ command: "/opt/todos" });
  picked = { code: 1, stdout: "", stderr: "User canceled. (-128)" };
  expect((await body(await c.action("lists.pickScript", { workspaceId: "acme" }))).data).toEqual({ command: null });
});
