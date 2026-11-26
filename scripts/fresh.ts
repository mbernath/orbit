// `bun run fresh`: a throwaway Orbit for trying the first run by hand (docs/design/onboarding.md, ADR-0041).
// Port 4748, a new empty data folder, GitHub off; Claude Code's transcripts and settings are read, never written.
// The real Orbit on 4747 and its ~/.orbit are not touched.
// `--demo` also plays live sessions (scripts/demo-events.ts) into the most recent suggested folder, until Ctrl-C.
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "../src/server";
import { readProjectFolders, suggestFolders } from "../src/sources/claude/folders";
import { DEMO_ROUND_MS, demoSteps } from "./demo-events";

const port = Number(process.env.ORBIT_FRESH_PORT) || 4748; // override only when 4748 is taken
const home = mkdtempSync(join(tmpdir(), "orbit-fresh-"));
await createOrbit({ port, home, github: false });
const url = `http://127.0.0.1:${port}`;
// hint progress lives in localStorage per origin: without the reset, hints retired last time stay away
console.log(`Fresh Orbit at ${url}/?hints=reset  (data: ${home})`);
console.log(`Send one live session there:  ORBIT_URL=${url} ORBIT_HOME=${home} claude`);

if (process.argv.includes("--demo")) {
  const folder = suggestFolders(readProjectFolders(join(homedir(), ".claude", "projects")), [])[0];
  if (!folder) console.log("Demo: no project folder in Claude Code's transcripts, nothing to play.");
  else {
    console.log(`Demo: live sessions in ${folder.path} — create the island "${folder.name}" from the suggestion to see them. Ctrl-C stops.`);
    const token = readFileSync(join(home, "hook-token"), "utf8").trim();
    // one hook event, as hooks/orbit-hook.sh sends it (no Git headers: they are optional); one after the other, in order
    let queue: Promise<unknown> = Promise.resolve();
    const send = (body: object) =>
      (queue = queue.then(() =>
        fetch(`${url}/events`, { method: "POST", headers: { "Content-Type": "application/json", "X-Orbit-Token": token }, body: JSON.stringify(body) })
          .catch(() => {})));
    const play = (round: number) => {
      for (const s of demoSteps(folder.path, round)) setTimeout(() => void send(s.event), s.at);
      setTimeout(() => play(round + 1), DEMO_ROUND_MS);
    };
    play(1);
  }
}
