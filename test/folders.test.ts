// First run (ADR-0041): the folders Claude Code was used in, read from the projects dir, as island suggestions.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FolderSuggestion } from "../src/core/types";
import { createOrbit } from "../src/server";
import { encodeProjectDir } from "../src/sources/claude/transcripts";
import { readProjectFolders, suggestFolders } from "../src/sources/claude/folders";
import { BOARD_TOKEN, client } from "./helpers";

const home = mkdtempSync(join(tmpdir(), "orbit-test-"));
const projects = join(home, "projects");
const day = 86_400_000;
const now = Date.now();

/** a project dir with `n` transcripts in `cwd`, the newest `daysAgo` old */
function project(cwd: string, n: number, daysAgo: number) {
  mkdirSync(cwd, { recursive: true });
  const dir = join(projects, encodeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const file = join(dir, `${cwd.split("/").pop()}-${i}.jsonl`);
    const lines = [
      { type: "summary", summary: "no cwd on this line" },
      { type: "user", sessionId: `${cwd.split("/").pop()}-${i}`, cwd, timestamp: new Date(now).toISOString(), message: { content: "Hello" } },
    ];
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const t = (now - (daysAgo + i) * day) / 1000;
    utimesSync(file, t, t);
  }
}

const alpha = join(home, "src", "alpha"), beta = join(home, "src", "beta"), gamma = join(home, "src", "gamma");
project(alpha, 3, 5);
project(beta, 2, 1);
project(gamma, 1, 10);
mkdirSync(join(projects, "empty-project")); // no transcripts: no suggestion
mkdirSync(join(projects, "-gone"));
writeFileSync(join(projects, "-gone", "x.jsonl"), JSON.stringify({ type: "user", cwd: join(home, "gone") }) + "\n"); // folder no longer exists

test("each project dir gives its folder, session count and last use; most recent first", () => {
  const f = readProjectFolders(projects);
  expect(f.map((x) => [x.path, x.sessions])).toEqual([[beta, 2], [alpha, 3], [gamma, 1]]);
  expect(Math.abs(f[0]!.lastUsed - (now - day))).toBeLessThan(2000);
});

test("suggestions skip folders inside an island, name is the folder name, at most five", () => {
  const s: FolderSuggestion[] = suggestFolders(readProjectFolders(projects), [join(home, "src", "alpha")]);
  expect(s.map((x) => x.name)).toEqual(["beta", "gamma"]);
  expect(s[0]).toEqual({ name: "beta", path: beta, sessions: 2, recent: 2, lastUsed: expect.any(Number) });
  const many = Array.from({ length: 8 }, (_, i) => ({ path: `/x/p${i}`, sessions: 1, recent: 0, lastUsed: 100 - i }));
  expect(suggestFolders(many, []).map((x) => x.name)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
});

test("recent counts the transcripts changed in the last 7 days", () => {
  // alpha: 5, 6 and 7 days old — the 7-day-old one is just outside; gamma: 10 days
  const f = readProjectFolders(projects, now + 1000);
  expect(f.map((x) => [x.path.split("/").pop(), x.sessions, x.recent])).toEqual([["beta", 2, 2], ["alpha", 3, 2], ["gamma", 1, 0]]);
});

test("a missing projects dir gives no suggestions", () => {
  expect(readProjectFolders(join(home, "nowhere"))).toEqual([]);
});

const port = 47300 + Math.floor(Math.random() * 400);
let orbit: Awaited<ReturnType<typeof createOrbit>>;
beforeAll(async () => {
  orbit = await createOrbit({ home, port, claudeProjects: projects, github: false, boardToken: BOARD_TOKEN, claudeImportMs: 0 });
});
afterAll(() => orbit.stop());

test("GET /api/claude/folders serves the suggestions; a new island drops its folder at once", async () => {
  const base = `http://127.0.0.1:${port}`;
  const folders = async () => ((await (await fetch(`${base}/api/claude/folders`)).json()) as FolderSuggestion[]).map((f) => f.name);
  expect(await folders()).toEqual(["beta", "alpha", "gamma"]);
  const api = client(base, () => orbit.hookToken);
  expect((await api.action("workspaces.add", { name: "beta", path: beta })).status).toBe(200);
  expect(await folders()).toEqual(["alpha", "gamma"]);
  // the island's sessions are imported
  expect((await api.state()).entities.filter((e) => e.kind === "session" && e.workspaceId === "beta")).toHaveLength(2);
});
