// Classifies what Claude Code writes into a transcript besides prompts and answers (ADR-0026). Pure.
import { oneLine, truncate } from "../../core/util";

/** Inner text of the first `<tag>…</tag>`, trimmed; null if absent. */
function tag(text: string, name: string): string | null {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1]!.trim() : null;
}

const short = (s: string) => truncate(oneLine(s), 200);

/**
 * A short note for a user message Claude Code injected (background task done, slash command, `!` command,
 * unknown wrapper), or null if the user typed it.
 */
export function systemNote(text: string): string | null {
  const t = text.trim();
  if (t.startsWith("<task-notification>")) {
    const failed = /^(failed|error|killed)$/i.test(tag(t, "status") ?? "");
    const summary = tag(t, "summary") ?? "";
    return `Background task ${failed ? "failed" : "done"}${summary ? `: ${short(summary)}` : ""}`;
  }
  const command = tag(t, "command-name");
  if (command) return short(`Command ${command} ${tag(t, "command-args") ?? ""}`.trim());
  const input = tag(t, "bash-input");
  if (input !== null) return `Shell: ${short(input)}`;
  const stdout = tag(t, "bash-stdout");
  if (stdout !== null) return short(`Shell output: ${stdout || tag(t, "bash-stderr") || "(empty)"}`);
  const local = tag(t, "local-command-stdout");
  if (local !== null) return short(`Output: ${local || "(empty)"}`);
  const unknown = t.match(/^<([a-z][\w-]*)>[\s\S]*<\/\1>$/);
  return unknown ? `System message (${unknown[1]})` : null;
}

export type TodoProgress = { done: number; total: number; current: string | null };

/** Progress of a `TodoWrite` task list; null without a list. */
export function todoProgress(input: any): TodoProgress | null {
  const todos = Array.isArray(input?.todos) ? input.todos : null;
  if (!todos?.length) return null;
  const current = todos.find((x: any) => x?.status === "in_progress");
  return {
    done: todos.filter((x: any) => x?.status === "completed").length,
    total: todos.length,
    current: current ? short(String(current.activeForm ?? current.content ?? "")) : null,
  };
}

/** The same as a line: "Tasks 2/5 · <current task>". */
export function todoNote(input: any): string | null {
  const p = todoProgress(input);
  return p ? `Tasks ${p.done}/${p.total}${p.current ? ` · ${p.current}` : ""}` : null;
}

export type WaitReason = { kind: "permission" | "question" | "plan"; text: string };

/** Why a session waits on a tool (ADR-0027): a question to answer, a plan to approve, or a permission. */
export function waitReason(tool: string | undefined, input: any): WaitReason {
  if (tool === "AskUserQuestion") {
    const qs = Array.isArray(input?.questions) ? input.questions : [];
    const first = String(qs[0]?.question ?? "Question");
    return { kind: "question", text: short(qs.length > 1 ? `${first} (+${qs.length - 1})` : first) };
  }
  if (tool === "ExitPlanMode") {
    const line = String(input?.plan ?? "").split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
    return { kind: "plan", text: line ? short(line) : "Plan" };
  }
  return { kind: "permission", text: toolLine({ name: tool, input }) };
}

/** One line for a tool call: its name and the most telling argument (file, command, pattern). */
export function toolLine(b: any): string {
  const i = b?.input ?? {};
  const arg = i.file_path ?? i.path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? "";
  return truncate(oneLine(`${b?.name ?? "Tool"} ${typeof arg === "string" ? arg : ""}`.trim()), 140);
}
