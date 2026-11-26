// Shared test client for an Orbit instance.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedEntity, Spawner, StateResponse } from "../src/core/types";

export const BOARD_TOKEN = "test-board-token";

export function client(base: string, hookToken: () => string) {
  const state = async () => (await fetch(`${base}/api/state`)).json() as Promise<StateResponse>;
  return {
    state,
    entity: async (ref: string): Promise<ResolvedEntity | undefined> => (await state()).entities.find((e) => e.ref === ref),
    element: async (ref: string) => (await state()).elements.find((e) => e.id === ref),
    session: async (id: string) => (await state()).entities.find((e) => e.ref === `session:claude/${id}`),
    hook: (body: object, headers: Record<string, string> = {}) =>
      fetch(`${base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orbit-Token": hookToken(), ...headers },
        body: JSON.stringify(body),
      }),
    action: (id: string, input: object = {}, confirm = false) =>
      fetch(`${base}/api/actions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orbit-Token": BOARD_TOKEN },
        body: JSON.stringify({ input, confirm }),
      }),
  };
}

// ---------- Replaying recorded `claude -p` streams (test/fixtures/claude-stream, ADR-0019) ----------

export const streamFixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "claude-stream", `${name}.jsonl`), "utf8").trim().split("\n");

export type SpawnCall = { cmd: string[]; cwd?: string; env?: Record<string, string | undefined>; writes: string[]; ended: boolean };

/**
 * A spawner that plays recorded streams instead of starting Claude Code. Each process takes the next recording.
 * A recording is cut after every `result` and `control_request` and before every `control_response`; each line written to stdin releases the next part,
 * so the test drives the turns like the CLI would. Closing stdin ends the process with code 0.
 */
export function replaySpawner(...recordings: string[][]) {
  const calls: SpawnCall[] = [];
  const spawn: Spawner = (cmd, opts) => {
    const lines = recordings.shift() ?? [];
    const parts: string[][] = [[]];
    for (const l of lines) {
      const t = JSON.parse(l).type;
      // a control_response answers a request Orbit wrote (an interrupt): it comes after that write
      if (t === "control_response" && (parts.at(-1) as string[]).length) parts.push([]);
      (parts.at(-1) as string[]).push(l);
      if (t === "result" || t === "control_request") parts.push([]);
    }
    const call: SpawnCall = { cmd, cwd: opts.cwd, env: opts.env, writes: [], ended: false };
    calls.push(call);
    let done: (code: number) => void = () => {};
    const exited = new Promise<number>((r) => (done = r));
    return {
      write(line) {
        if (call.ended) return;
        call.writes.push(line);
        const part = parts.shift() ?? [];
        setTimeout(() => part.forEach((l) => opts.onLine(l)), 1);
      },
      end() {
        call.ended = true;
        setTimeout(() => done(0), 2);
      },
      kill() {
        call.ended = true;
        done(143);
      },
      exited,
    };
  };
  return { spawn, calls };
}
