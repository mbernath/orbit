// A stand-in for `claude -p` in the browser tests (ADR-0019): answers in the recorded stream format and reports
// to Orbit's hook like the real CLI with installed hooks would. Never starts Claude Code.
import type { Spawner } from "../../src/core/types";

/**
 * Every message gets "On it." and ends the turn (one with the word "long" keeps working); one mentioning "file" first asks for
 * permission to use Write and answers "Done." or "Then I'll leave it." depending on the user's answer. One mentioning "colour"
 * asks a question, one mentioning "plan" proposes a plan.
 * @param hook posts a hook event to Orbit (SessionStart, UserPromptSubmit)
 */
export function fakeClaude(hook: (body: object) => Promise<unknown>): Spawner {
  return (cmd, opts) => {
    const flag = cmd.indexOf("--session-id") >= 0 ? cmd.indexOf("--session-id") : cmd.indexOf("--resume");
    const id = cmd[flag + 1] ?? "unknown";
    const cwd = opts.cwd ?? "/";
    let done: (code: number) => void = () => {};
    const exited = new Promise<number>((r) => (done = r));
    let open = true;
    let started = false;
    let longTurn = false;
    const say = (o: object) => setTimeout(() => open && opts.onLine(JSON.stringify(o)), 5);
    const text = (t: string) => say({ type: "assistant", session_id: id, message: { content: [{ type: "text", text: t }] } });
    // like the real CLI with installed hooks: the turn's end is reported by the Stop hook, then the stream's result
    const result = (t: string) =>
      setTimeout(async () => {
        if (!open) return;
        await hook({ session_id: id, hook_event_name: "Stop", cwd, last_assistant_message: t });
        say({ type: "result", subtype: "success", is_error: false, result: t, session_id: id });
      }, 5);
    return {
      async write(line) {
        if (!open) return;
        const m = JSON.parse(line);
        if (m.type === "user") {
          const content = String(m.message.content);
          longTurn = /\blong\b/i.test(content);
          if (!started) await hook({ session_id: id, hook_event_name: "SessionStart", cwd });
          started = true;
          await hook({ session_id: id, hook_event_name: "UserPromptSubmit", cwd, prompt: m.message.content });
          say({ type: "system", subtype: "init", session_id: id, model: "claude-haiku-fake", permissionMode: "default", apiKeySource: "none" });
          if (/\bfile\b/i.test(content)) {
            // like the real CLI with installed hooks: the question is also reported to Orbit's hook
            await hook({ session_id: id, hook_event_name: "PermissionRequest", cwd, tool_name: "Write", tool_input: { file_path: "note.md" } });
            await hook({ session_id: id, hook_event_name: "Notification", cwd, notification_type: "permission_prompt", message: "Claude needs your permission to use Write" });
            say({ type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "Write", display_name: "Write", input: { file_path: "note.md" }, description: "note.md" } });
            return;
          }
          if (/\bcolou?r\b/i.test(content)) {
            // a question of Claude (ADR-0028), in the format recorded from the real CLI
            const questions = [{ question: "Which colour?", header: "Colour", multiSelect: false, options: [{ label: "Red", description: "" }, { label: "Blue", description: "" }] }];
            say({ type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", display_name: "AskUserQuestion", input: { questions } } });
            return;
          }
          if (/\bplan\b/i.test(content)) {
            // a plan: written to a plan file, then ExitPlanMode without input, like the CLI
            say({ type: "assistant", session_id: id, message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/home/x/.claude/plans/p.md", content: "# Speed up the import\n\n1. Read only the end" } }] } });
            say({ type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", display_name: "ExitPlanMode", input: {} } });
            return;
          }
          text("On it.");
          if (!longTurn) result("On it."); // "… long …": keeps working
        }
        if (m.type === "control_response") {
          const answers = m.response.response.updatedInput?.answers;
          if (answers) return result(`You chose ${Object.values(answers).join(", ")}.`);
          if (m.response.response.message) return result(`Understood: ${m.response.response.message}`);
          const allowed = m.response.response.behavior === "allow";
          if (allowed) say({ type: "assistant", session_id: id, message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "note.md" } }] } });
          if (allowed && longTurn) return; // "… long …": keeps working after the permission, like a long real turn
          result(allowed ? "Done." : "Then I'll leave it.");
        }
      },
      end() {
        open = false;
        setTimeout(() => done(0), 5);
      },
      kill() {
        open = false;
        done(143);
      },
      exited,
    };
  };
}
