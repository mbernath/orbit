// Stale hook install (ADR-0031): which events the Orbit hook lacks, as a pure check and through the route.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { HOOK_EVENTS, isInstalled, missingHooks } from "../src/sources/claude/hook-setup";
import { BOARD_TOKEN } from "./helpers";

const orbitHook = { hooks: [{ type: "command", command: "/x/orbit/hooks/orbit-hook.sh" }] };
const other = { hooks: [{ type: "command", command: "/usr/local/bin/notify" }] };
const withEvents = (events: string[]) => ({ hooks: Object.fromEntries(events.map((e) => [e, [other, orbitHook]])) });

test("all events installed: nothing missing", () => {
  expect(missingHooks(withEvents(HOOK_EVENTS))).toEqual([]);
});

test("older install without PostToolUse: PostToolUse is missing", () => {
  expect(missingHooks(withEvents(HOOK_EVENTS.filter((e) => e !== "PostToolUse")))).toEqual(["PostToolUse"]);
});

test("only other tools' hooks for an event don't count", () => {
  const s = withEvents(HOOK_EVENTS);
  s.hooks.Stop = [other];
  expect(missingHooks(s)).toEqual(["Stop"]);
});

test("not installed at all or no settings: no notice", () => {
  expect(missingHooks(null)).toEqual([]);
  expect(missingHooks({})).toEqual([]);
  expect(missingHooks({ hooks: { Stop: [other] } })).toEqual([]);
});

const home = mkdtempSync(join(tmpdir(), "orbit-test-"));
const port = 47300 + Math.floor(Math.random() * 400);
let orbit: Awaited<ReturnType<typeof createOrbit>>;
beforeAll(async () => {
  writeFileSync(join(home, "settings.json"), JSON.stringify(withEvents(HOOK_EVENTS.filter((e) => e !== "PostToolUse"))));
  orbit = await createOrbit({ home, port, claudeProjects: join(home, "projects"), github: false, boardToken: BOARD_TOKEN });
});
afterAll(() => orbit.stop());

test("GET /api/claude/hooks rereads Claude's settings on every request", async () => {
  const check = async () => (await fetch(`http://127.0.0.1:${port}/api/claude/hooks`)).json();
  expect(await check()).toEqual({ missing: ["PostToolUse"], installed: true });
  writeFileSync(join(home, "settings.json"), JSON.stringify(withEvents(HOOK_EVENTS)));
  expect(await check()).toEqual({ missing: [], installed: true });
});

test("installed: any Orbit hook present, even a stale one; other tools' hooks don't count", () => {
  expect(isInstalled(withEvents(HOOK_EVENTS))).toBe(true);
  expect(isInstalled(withEvents(["Stop"]))).toBe(true);
  expect(isInstalled({ hooks: { Stop: [other] } })).toBe(false);
  expect(isInstalled(null)).toBe(false);
});

test("GET /api/claude/hooks also says whether the hook is installed at all (ADR-0041)", async () => {
  const check = async () => (await fetch(`http://127.0.0.1:${port}/api/claude/hooks`)).json();
  writeFileSync(join(home, "settings.json"), JSON.stringify({ effortLevel: "medium" }));
  expect(await check()).toEqual({ missing: [], installed: false });
  writeFileSync(join(home, "settings.json"), JSON.stringify(withEvents(HOOK_EVENTS)));
  expect(await check()).toEqual({ missing: [], installed: true });
});
