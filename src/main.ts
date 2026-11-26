import { homedir } from "node:os";
import { join } from "node:path";
import { createOrbit } from "./server";

const port = Number(process.env.ORBIT_PORT ?? 4747);
const home = process.env.ORBIT_HOME ?? join(homedir(), ".orbit");

// ORBIT_CLAUDE_PROJECTS points the transcript import elsewhere; the browser tests use it so they never read ~/.claude.
await createOrbit({ port, home, github: process.env.ORBIT_GITHUB !== "0", claudeProjects: process.env.ORBIT_CLAUDE_PROJECTS || undefined });
console.log(`Orbit running at http://127.0.0.1:${port}  (data: ${home})`);
