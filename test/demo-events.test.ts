// `bun run fresh --demo` (onboarding.md "Testing it by hand"): the scenario's events, not their timing.
import { expect, test } from "bun:test";
import { demoSteps } from "../scripts/demo-events";

test("one round: A works, then B asks to run npm test, then C finishes with a last message — all in the folder", () => {
  const steps = demoSteps("/x/harbor", 1);
  expect(steps.every((s) => s.event.cwd === "/x/harbor")).toBe(true);
  const last = new Map<string, string>();
  for (const s of steps) last.set(s.event.session_id!, s.event.hook_event_name!);
  expect([...last]).toEqual([["orbit-demo-1-a", "UserPromptSubmit"], ["orbit-demo-1-b", "PermissionRequest"], ["orbit-demo-1-c", "Stop"]]);
  const b = steps.find((s) => s.event.hook_event_name === "PermissionRequest")!;
  expect(b.event).toMatchObject({ tool_name: "Bash", tool_input: { command: "npm test" } });
  expect(steps.find((s) => s.event.hook_event_name === "Stop")!.event.last_assistant_message).toBeTruthy();
  // staggered and in order: B waits after A started, C finishes after B
  const at = (id: string) => steps.find((s) => s.event.session_id === id)!.at;
  expect(at("orbit-demo-1-a")).toBeLessThan(at("orbit-demo-1-b"));
  expect(at("orbit-demo-1-b")).toBeLessThan(at("orbit-demo-1-c"));
  expect(steps.map((s) => s.at)).toEqual([...steps.map((s) => s.at)].sort((x, y) => x - y));
  // every session starts with a prompt, so it has a title
  for (const id of last.keys()) expect(steps.some((s) => s.event.session_id === id && s.event.prompt)).toBe(true);
});

test("each round has new session ids", () => {
  const ids = (r: number) => new Set(demoSteps("/x", r).map((s) => s.event.session_id));
  expect([...ids(1)].some((id) => ids(2).has(id))).toBe(false);
});
