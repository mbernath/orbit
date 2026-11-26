// Streaming runner (ADR-0019): lines in, lines out, against a local Bun echo process (no external service).
import { expect, test } from "bun:test";
import { defaultSpawner } from "../src/core/runner";

// answers each stdin line with "echo:<line>" and exits with 3 when stdin closes; writes a note to stderr
const ECHO = `
process.stderr.write("ready\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) { console.log("echo:" + buf.slice(0, i)); buf = buf.slice(i + 1); }
});
process.stdin.on("end", () => process.exit(3));
`;

test("Lines go in and come out one by one; the end of stdin ends the process", async () => {
  const lines: string[] = [];
  let err = "";
  const p = defaultSpawner(["bun", "-e", ECHO], {
    onLine: (l) => {
      lines.push(l);
      if (l === "echo:one") p.write("two"); // answer after the first reply, like a turn
      if (l === "echo:two") p.end();
    },
    onStderr: (t) => (err += t),
  });
  p.write("one");
  expect(await p.exited).toBe(3);
  expect(lines).toEqual(["echo:one", "echo:two"]);
  expect(err).toContain("ready");
  p.write("too late"); // ignored after the end
});

test("The environment is passed exactly as the source sets it", async () => {
  const lines: string[] = [];
  const p = defaultSpawner(["bun", "-e", "console.log(process.env.ORBIT_X ?? 'empty', process.env.ANTHROPIC_API_KEY ?? 'unset')"], {
    env: { PATH: process.env.PATH, ORBIT_X: "yes" },
    onLine: (l) => lines.push(l),
  });
  expect(await p.exited).toBe(0);
  expect(lines).toEqual(["yes unset"]);
});

test("kill ends a hanging process; a missing program reports 127", async () => {
  const p = defaultSpawner(["bun", "-e", "setInterval(() => {}, 1000)"], { onLine: () => {} });
  p.kill();
  expect(await p.exited).not.toBe(0);
  let err = "";
  const missing = defaultSpawner(["orbit-does-not-exist"], { onLine: () => {}, onStderr: (t) => (err += t) });
  expect(await missing.exited).toBe(127);
  expect(err).not.toBe("");
});
