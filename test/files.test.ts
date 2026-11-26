// Files source (ADR-0011): pinning, reading, saving with conflict protection, path limits.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/core/types";
import { resolveReference } from "../src/sources/files/open";
import { createOrbit } from "../src/server";
import { BOARD_TOKEN, client } from "./helpers";

const home = realpathSync(mkdtempSync(join(tmpdir(), "orbit-files-")));
const ws = join(home, "work");
const outside = join(home, "outside");
const port = 48900 + Math.floor(Math.random() * 300);
let orbit: Awaited<ReturnType<typeof createOrbit>>;
const c = client(`http://127.0.0.1:${port}`, () => orbit.hookToken);

const roadmap = join(ws, "docs", "roadmap.md");
const tracked = new Set([roadmap]);
// "code" / "open" are recorded (ADR-0030); git stub: "ls-files --error-unmatch -- <name>" succeeds for tracked files.
const opened: string[][] = [];
let hasCode = true; // whether VS Code's CLI is installed
const run: Runner = async (cmd) => {
  if (cmd[0] === "code" || cmd[0] === "open") {
    opened.push(cmd);
    return { code: cmd[0] === "code" && !hasCode ? 127 : 0, stdout: "", stderr: "" };
  }
  const file = join(cmd[2] ?? "", cmd.at(-1) ?? "");
  return tracked.has(file) ? { code: 0, stdout: file, stderr: "" } : { code: 1, stdout: "", stderr: "error: pathspec did not match" };
};

beforeAll(async () => {
  mkdirSync(join(ws, "docs"), { recursive: true });
  mkdirSync(join(ws, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(ws, ".git"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(roadmap, "# Roadmap\n\n- [x] Stage 1\n- [ ] Stage 2\n");
  writeFileSync(join(ws, "notes.md"), "Notes");
  writeFileSync(join(ws, "readme.txt"), "not Markdown");
  writeFileSync(join(ws, "node_modules", "pkg", "README.md"), "ignore");
  writeFileSync(join(ws, ".git", "info.md"), "off limits");
  writeFileSync(join(outside, "secret.md"), "secret");
  symlinkSync(join(outside, "secret.md"), join(ws, "link.md"));
  writeFileSync(join(home, "workspaces.json"), JSON.stringify([{ id: "acme", name: "Acme", paths: [ws] }]));
  orbit = await createOrbit({
    home, port, claudeProjects: join(home, "none"), github: false, boardToken: BOARD_TOKEN, run, filesPollMs: 0,
  });
});
afterAll(() => orbit.stop());

const file = async (path: string) => c.entity(`file:fs/${path}`);

test("Picker list: all Markdown files in the workspace, without hidden and build folders", async () => {
  const list = (await (await fetch(`http://127.0.0.1:${port}/api/files/candidates`)).json()) as { rel: string }[];
  expect(list.map((x) => x.rel)).toEqual(["docs/roadmap.md", "notes.md"]); // symlinks are not offered either
});

test("Pinning makes the file an entity with content, hash and Git status", async () => {
  expect(await file(roadmap)).toBeUndefined();
  const res = await c.action("files.pin", { path: roadmap });
  expect(res.status).toBe(200);
  const e = (await file(roadmap))!;
  expect(e).toMatchObject({ kind: "file", status: "ok", title: "roadmap.md", workspaceId: "acme" });
  expect(e.data).toMatchObject({ rel: "docs/roadmap.md", content: "# Roadmap\n\n- [x] Stage 1\n- [ ] Stage 2\n", tracked: true });
  expect(e.actions).toEqual(["files.unpin", "files.save"]);

  await c.action("files.pin", { path: join(ws, "notes.md") });
  expect((await file(join(ws, "notes.md")))!.data.tracked).toBe(false);
});

test("Path limits: only .md, only in the workspace, no symlink to outside, nothing in .git", async () => {
  const pin = async (path: string) => ((await (await c.action("files.pin", { path })).json()) as { error?: string }).error;
  expect(await pin(join(ws, "readme.txt"))).toBe("Only Markdown files (.md) are allowed.");
  expect(await pin(join(outside, "secret.md"))).toBe("The file isn't in any island.");
  expect(await pin(join(ws, "link.md"))).toBe("The file isn't in any island.");
  expect(await pin(join(ws, ".git", "info.md"))).toBe("Files in .git are off limits.");
  expect(await pin(join(ws, "missing.md"))).toBe("File not found.");
});

test("Saving with a matching hash writes atomically", async () => {
  const e = (await file(roadmap))!;
  const res = await c.action("files.save", { path: roadmap, content: "# Roadmap\n\n- [x] Stage 2\n", baseHash: e.data.hash });
  expect(res.status).toBe(200);
  expect(readFileSync(roadmap, "utf8")).toBe("# Roadmap\n\n- [x] Stage 2\n");
  expect(readdirSync(join(ws, "docs"))).toEqual(["roadmap.md"]); // no temp file left behind
  expect((await file(roadmap))!.data.content).toBe("# Roadmap\n\n- [x] Stage 2\n");
});

test("Conflict: if the file has changed in the meantime, it is not overwritten", async () => {
  const before = (await file(roadmap))!;
  writeFileSync(roadmap, "# Roadmap\n\nchanged by an agent\n"); // e.g. an agent or another editor
  const res = await c.action("files.save", { path: roadmap, content: "my version", baseHash: before.data.hash });
  expect(res.status).toBe(409);
  expect(readFileSync(roadmap, "utf8")).toBe("# Roadmap\n\nchanged by an agent\n");

  // the conflict itself refreshes the entity, without waiting for the poll, so the board can offer the choice
  const after = (await file(roadmap))!;
  // ADR-0020: the external change is a domain event
  const ev = orbit.db.query(`SELECT payload FROM event_log WHERE type = 'event.file.changed' ORDER BY id DESC LIMIT 1`).get() as { payload: string };
  expect(JSON.parse(ev.payload)).toEqual({ type: "file.changed", path: roadmap });
  expect(after.data.content).toBe("# Roadmap\n\nchanged by an agent\n");
  // Explicit overwrite: the board resends with the new hash.
  expect((await c.action("files.save", { path: roadmap, content: "my version", baseHash: after.data.hash })).status).toBe(200);
  expect(readFileSync(roadmap, "utf8")).toBe("my version");
});

test("Unpinning removes the file from the board, not from the disk", async () => {
  await c.action("files.unpin", { path: join(ws, "notes.md") });
  expect(await file(join(ws, "notes.md"))).toBeUndefined();
  expect(readFileSync(join(ws, "notes.md"), "utf8")).toBe("Notes");
});

test("Opening (ADR-0030): code in VS Code at the line, HTML and folders with open, relative to the base folder", async () => {
  writeFileSync(join(ws, "app.ts"), "export {}\n");
  writeFileSync(join(ws, "docs", "storyboard.html"), "<h1>Demo</h1>");
  const open = async (input: object) => {
    opened.length = 0;
    const res = await c.action("files.open", input);
    return { status: res.status, body: (await res.json()) as { error?: string }, cmds: [...opened] };
  };
  expect((await open({ path: "app.ts", base: ws, line: 12 })).cmds).toEqual([["code", "-g", `${join(ws, "app.ts")}:12`]]);
  expect((await open({ path: `file://${join(ws, "docs", "storyboard.html")}` })).cmds).toEqual([["open", join(ws, "docs", "storyboard.html")]]);
  expect((await open({ path: join(ws, "docs") })).cmds).toEqual([["open", join(ws, "docs")]]);
  expect((await open({ path: "../app.ts", base: join(ws, "docs") })).cmds[0]?.[2]).toBe(join(ws, "app.ts"));
  hasCode = false; // without VS Code's CLI the default app opens it
  expect((await open({ path: join(ws, "app.ts") })).cmds).toEqual([["code", "-g", join(ws, "app.ts")], ["open", join(ws, "app.ts")]]);
  hasCode = true;
});

test("Opening a relative path falls back to the parent folders, so repo-relative paths work from a subfolder cwd", async () => {
  mkdirSync(join(ws, "assets", "graphics", "src"), { recursive: true });
  writeFileSync(join(ws, "assets", "graphics", "pic.png"), "png");
  writeFileSync(join(ws, "assets", "graphics", "src", "label.py"), "print()\n");
  const base = join(ws, "assets", "graphics");
  const first = async (input: object) => {
    opened.length = 0;
    await c.action("files.open", input);
    return opened[0]?.at(-1);
  };
  expect(await first({ path: "assets/graphics/pic.png", base })).toBe(join(ws, "assets", "graphics", "pic.png"));
  expect(await first({ path: "src/label.py", base })).toBe(join(ws, "assets", "graphics", "src", "label.py")); // the cwd still wins
  expect(((await (await c.action("files.open", { path: "assets/nope.png", base })).json()) as { error?: string }).error).toBe("File not found.");
});

test("Opening keeps the path limits", async () => {
  const error = async (input: object) => ((await (await c.action("files.open", input)).json()) as { error?: string }).error;
  opened.length = 0;
  expect(await error({ path: join(outside, "secret.md") })).toBe("The file isn't in any island.");
  expect(await error({ path: join(ws, "link.md") })).toBe("The file isn't in any island.");
  expect(await error({ path: join(ws, ".git", "info.md") })).toBe("Files in .git are off limits.");
  expect(await error({ path: join(ws, "missing.ts") })).toBe("File not found.");
  expect(await error({ path: "app.ts" })).toBe("Relative path without a folder to resolve it from.");
  expect(opened).toEqual([]);
});

test("Resolving references: file://, ~, absolute, relative, URL-encoded", () => {
  expect(resolveReference("file:///Users/m/a%20b.html")).toBe("/Users/m/a b.html");
  expect(resolveReference("~/x/y.md", null, "/Users/m")).toBe("/Users/m/x/y.md");
  expect(resolveReference("/abs/z.ts", "/ignored")).toBe("/abs/z.ts");
  expect(resolveReference("src/a%20b.ts", "/repo")).toBe("/repo/src/a b.ts");
  expect(resolveReference("src/a.ts")).toBeNull();
});

// ---------- Preview (ADR-0040) ----------
const raw = (q: Record<string, string>, token: string | null = BOARD_TOKEN) =>
  fetch(`http://127.0.0.1:${port}/api/files/raw?${new URLSearchParams(q)}`, { headers: token ? { "X-Orbit-Token": token } : {} });

test("Preview serves images, PDFs and text with the board token, resolved like files.open", async () => {
  writeFileSync(join(ws, "assets", "graphics", "pic.svg"), "<svg/>");
  writeFileSync(join(ws, "doc.pdf"), "%PDF-1.4");
  const base = join(ws, "assets", "graphics");
  const png = await raw({ path: "assets/graphics/pic.png", base });
  expect(png.status).toBe(200);
  expect(png.headers.get("content-type")).toBe("image/png");
  expect(decodeURIComponent(png.headers.get("x-orbit-path")!)).toBe(join(ws, "assets", "graphics", "pic.png"));
  expect(png.headers.get("content-security-policy")).toBe("sandbox");
  expect(png.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await png.text()).toBe("png");
  expect((await raw({ path: join(base, "pic.svg") })).headers.get("content-type")).toBe("image/svg+xml");
  expect((await raw({ path: join(ws, "doc.pdf") })).headers.get("content-type")).toBe("application/pdf");
  const code = await raw({ path: "src/label.py", base });
  expect(code.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await code.text()).toBe("print()\n");
  expect((await raw({ path: "docs/roadmap.md", base: ws })).headers.get("content-type")).toBe("text/markdown; charset=utf-8");
});

test("Preview keeps the limits: token, workspace, .git, no HTML, no folders", async () => {
  expect((await raw({ path: join(ws, "app.ts") }, null)).status).toBe(401);
  expect((await raw({ path: join(outside, "secret.md") })).status).toBe(400);
  expect((await raw({ path: join(ws, ".git", "info.md") })).status).toBe(400);
  expect((await raw({ path: join(ws, "missing.png") })).status).toBe(404);
  const html = await raw({ path: join(ws, "docs", "storyboard.html") });
  expect(html.status).toBe(415);
  expect(await html.json()).toMatchObject({ path: join(ws, "docs", "storyboard.html"), size: 13 });
  writeFileSync(join(ws, "data.zip"), "PK");
  expect((await raw({ path: join(ws, "data.zip") })).status).toBe(415);
  expect((await raw({ path: join(ws, "docs") })).status).toBe(415);
});

test("Show in Finder reveals the file with open -R", async () => {
  opened.length = 0;
  await c.action("files.open", { path: join(ws, "app.ts"), reveal: true });
  expect(opened).toEqual([["open", "-R", join(ws, "app.ts")]]);
});
