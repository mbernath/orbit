// Browser tests for the board (ADR-0018). Run with `bun run test:e2e`.
// Files are named *.e2e.ts so `bun test` does not pick them up.
// Two servers: "board" shares one filled fixture across its files (debt #10); "first-run" starts from an empty data
// folder with three transcript projects (ADR-0041).
import { defineConfig } from "@playwright/test";
import { EMPTY_PORT } from "./test/e2e/onboarding/fixture";

const port = 47911;
const base = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  use: { viewport: { width: 1400, height: 900 } },
  projects: [
    {
      name: "board",
      testIgnore: "onboarding/**",
      // the filled board starts with every first-run hint retired (ADR-0041), so they never cover what these tests look at
      use: {
        baseURL: base,
        storageState: { cookies: [], origins: [{ origin: base, localStorage: [{ name: "orbit.hints", value: JSON.stringify(["tidy", "open", "snooze", "jump", "island", "keys"]) }] }] },
      },
    },
    { name: "first-run", testMatch: "onboarding/**/*.e2e.ts", use: { baseURL: `http://127.0.0.1:${EMPTY_PORT}` } },
  ],
  webServer: [
    { command: "bun test/e2e/serve.ts", url: `${base}/`, reuseExistingServer: false, env: { ORBIT_E2E_PORT: String(port) } },
    { command: "bun test/e2e/onboarding/serve.ts", url: `http://127.0.0.1:${EMPTY_PORT}/`, reuseExistingServer: false },
  ],
});
