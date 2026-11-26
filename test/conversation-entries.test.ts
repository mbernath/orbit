// ADR-0026: system-injected user messages become neutral notes, never "you" text.
import { expect, test } from "bun:test";
import { systemNote, todoNote, todoProgress, waitReason } from "../src/sources/claude/entries";

test("Background task done: summary and status", () => {
  const text = `<task-notification>
<task-id>b0s0l24r1</task-id>
<status>completed</status>
<summary>Background command "for i in $(seq 1 20); do …" completed (exit code 0)</summary>
</task-notification>`;
  expect(systemNote(text)).toBe('Background task done: Background command "for i in $(seq 1 20); do …" completed (exit code 0)');
  expect(systemNote(text.replace("completed</status>", "failed</status>"))).toStartWith("Background task failed: ");
});

test("Slash command and ! command", () => {
  expect(systemNote("<command-message>work-run</command-message>\n<command-name>/work-run</command-name>\n<command-args>#489</command-args>")).toBe("Command /work-run #489");
  expect(systemNote("<command-name>/clear</command-name>\n<command-args></command-args>")).toBe("Command /clear");
  expect(systemNote("<bash-input>git status</bash-input>")).toBe("Shell: git status");
  expect(systemNote("<bash-stdout>On branch main</bash-stdout><bash-stderr></bash-stderr>")).toBe("Shell output: On branch main");
  expect(systemNote("<local-command-stdout>Set model to opus</local-command-stdout>")).toBe("Output: Set model to opus");
});

test("An unknown tag becomes a neutral system line, normal text stays a prompt", () => {
  expect(systemNote("<foo-bar>\nanything\n</foo-bar>")).toBe("System message (foo-bar)");
  expect(systemNote("Please change <b>this</b>")).toBeNull();
  expect(systemNote("Make the import faster")).toBeNull();
});

test("Task list: progress and current task", () => {
  expect(
    todoNote({ todos: [
      { content: "ADR", status: "completed" },
      { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
      { content: "Code", status: "pending" },
    ] }),
  ).toBe("Tasks 1/3 · Writing tests");
  expect(todoNote({ todos: [{ content: "a", status: "completed" }] })).toBe("Tasks 1/1");
  expect(todoNote({})).toBeNull();
});

test("Wait reason: permission, question with its text, plan with its heading", () => {
  expect(waitReason("Bash", { command: "npm test" })).toEqual({ kind: "permission", text: "Bash npm test" });
  expect(
    waitReason("AskUserQuestion", { questions: [{ question: "Which variant?", options: [] }, { question: "And this?" }] }),
  ).toEqual({ kind: "question", text: "Which variant? (+1)" });
  expect(waitReason("ExitPlanMode", { plan: "\n# Speed up the import\n\n1. …" })).toEqual({ kind: "plan", text: "Speed up the import" });
  expect(waitReason("ExitPlanMode", {})).toEqual({ kind: "plan", text: "Plan" });
});

test("Task list progress as data", () => {
  expect(todoProgress({ todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] })).toEqual({ done: 1, total: 2, current: "b" });
  expect(todoProgress({ todos: [] })).toBeNull();
});

test("An interrupted turn reads as a note, not as the user's words (ADR-0044)", () => {
  expect(systemNote("[Request interrupted by user]")).toBe("Stopped by you");
  expect(systemNote("[Request interrupted by user for tool use]")).toBe("Stopped by you");
  expect(systemNote("Please [Request interrupted by user]")).toBeNull();
});
