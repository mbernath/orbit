// The empty-board fixture for the first-run tests (ADR-0041): shared by the server and the tests, so both find the
// same folders. A fixed path under the temp dir (the test workers and the server are separate processes).
import { tmpdir } from "node:os";
import { join } from "node:path";

export const EMPTY_PORT = 47912;
export const EMPTY_HOME = join(tmpdir(), `orbit-e2e-empty-${EMPTY_PORT}`);
export const PROJECTS = join(EMPTY_HOME, "claude-projects");
/** three folders Claude Code was used in, most recent first: name and the age in days of each session (`<name>-1` first).
 * harbor has 3 sessions of this week and 15 older ones, so its island keeps only the recent ones (stage 1b). */
export const FOLDERS = [
  { name: "harbor", days: [1, 2, 3, ...Array.from({ length: 15 }, (_, i) => 10 + i)] },
  { name: "lumen", days: [3, 4] },
  { name: "quill", days: [8] },
];
export const folderPath = (name: string) => join(EMPTY_HOME, "src", name);
