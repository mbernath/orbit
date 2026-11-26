// Starts Orbit for the first-run tests (ADR-0041): an empty data folder (no island) and transcripts of three
// projects in a temp dir. Never touches ~/.orbit or ~/.claude; no hook installed (Claude's settings without hooks).
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOrbit } from "../../../src/server";
import { encodeProjectDir } from "../../../src/sources/claude/transcripts";
import { EMPTY_HOME, EMPTY_PORT, FOLDERS, folderPath, PROJECTS } from "./fixture";

rmSync(EMPTY_HOME, { recursive: true, force: true });
mkdirSync(PROJECTS, { recursive: true });
writeFileSync(join(EMPTY_HOME, "settings.json"), JSON.stringify({ effortLevel: "medium" }));
const day = 86_400_000;
for (const f of FOLDERS) {
  const cwd = folderPath(f.name);
  mkdirSync(cwd, { recursive: true });
  const dir = join(PROJECTS, encodeProjectDir(cwd));
  mkdirSync(dir);
  for (const [i, days] of f.days.entries()) {
    const id = `${f.name}-${i + 1}`, at = Date.now() - days * day;
    const file = join(dir, `${id}.jsonl`);
    writeFileSync(file, [
      { type: "user", sessionId: id, cwd, timestamp: new Date(at - 60_000).toISOString(), message: { content: `Work on ${f.name} ${i + 1}` } },
      { type: "assistant", sessionId: id, cwd, timestamp: new Date(at).toISOString(), message: { content: [{ type: "text", text: "Done." }] } },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n");
    utimesSync(file, at / 1000, at / 1000);
  }
}

await createOrbit({ home: EMPTY_HOME, port: EMPTY_PORT, claudeProjects: PROJECTS, github: false, filesPollMs: 0, boardToken: "e2e-board-token", claudeImportMs: 0, run: async () => ({ code: 1, stdout: "", stderr: "no commands in the first-run test" }) });
console.log(`Orbit first-run e2e server on ${EMPTY_PORT} (data: ${EMPTY_HOME})`);
