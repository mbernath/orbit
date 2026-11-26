// The scenario of `bun run fresh --demo` (docs/design/onboarding.md "Testing it by hand"): hook events as Claude
// Code's hook sends them, staggered so the hints come at their moments. Pure, so it can be tested; fresh.ts sends.
import type { HookInput } from "../src/sources/claude/hooks";

export type DemoStep = { at: number; event: HookInput };

/** one round with new session ids (`round` keeps them apart); `at` in ms from the round's start */
export function demoSteps(cwd: string, round = 1): DemoStep[] {
  const id = (s: string) => `orbit-demo-${round}-${s}`;
  const a = id("a"), b = id("b"), c = id("c");
  return [
    { at: 0, event: { session_id: a, hook_event_name: "SessionStart", cwd } },
    { at: 0, event: { session_id: a, hook_event_name: "UserPromptSubmit", cwd, prompt: "Refactor the settings loader so it reads the config file once and caches it" } },
    { at: 20_000, event: { session_id: b, hook_event_name: "SessionStart", cwd } },
    { at: 20_000, event: { session_id: b, hook_event_name: "UserPromptSubmit", cwd, prompt: "Fix the flaky date test in the report module" } },
    { at: 21_000, event: { session_id: b, hook_event_name: "PermissionRequest", cwd, tool_name: "Bash", tool_input: { command: "npm test" } } },
    { at: 60_000, event: { session_id: c, hook_event_name: "SessionStart", cwd } },
    { at: 60_000, event: { session_id: c, hook_event_name: "UserPromptSubmit", cwd, prompt: "Update the README with the new install steps" } },
    {
      at: 62_000,
      event: { session_id: c, hook_event_name: "Stop", cwd, last_assistant_message: "Updated the README: install now runs in two steps, and the old Homebrew note is gone." },
    },
  ];
}

/** how long one round runs before the next starts with new sessions */
export const DEMO_ROUND_MS = 4 * 60_000;
