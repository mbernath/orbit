// Folder picker for a new island: the native macOS dialog through the runner, stubbed here.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaces } from "../src/core/workspaces";
import type { Runner } from "../src/core/types";

const pick = (run: Runner) => {
  const ws = createWorkspaces(mkdtempSync(join(tmpdir(), "orbit-pick-")), () => {}, run);
  return ws.actions.find((a) => a.id === "workspaces.pickFolder")!;
};

test("Choosing a folder returns the chosen path without a trailing slash", async () => {
  let cmd: string[] = [];
  const a = pick(async (c) => ((cmd = c), { code: 0, stdout: "/Users/m/Src/portal/\n", stderr: "" }));
  expect(await a.run({})).toEqual({ ok: true, data: { path: "/Users/m/Src/portal" } });
  expect(cmd[0]).toBe("osascript");
});

test("Cancelling the dialog is no error, just no path", async () => {
  const a = pick(async () => ({ code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" }));
  expect(await a.run({})).toEqual({ ok: true, data: { path: null } });
});

test("A missing dialog is reported as an error", async () => {
  const a = pick(async () => ({ code: 127, stdout: "", stderr: "not found" }));
  expect((await a.run({})).ok).toBe(false);
});
