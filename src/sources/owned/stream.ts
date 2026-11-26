// What a line of `claude -p --output-format stream-json` means for an owned session (ADR-0019).
// Pure: state in, state out, so it is tested against recorded streams (test/fixtures/claude-stream).
import { splitTitle } from "../../core/util";

export type Question = { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] };

export type Permission = {
  requestId: string; tool: string; description: string; input: Record<string, unknown>;
  /** permission: Allow/Deny · question: AskUserQuestion, answered with options · plan: ExitPlanMode (ADR-0028) */
  kind: "permission" | "question" | "plan";
  questions?: Question[];
  /** the plan in Markdown: from the tool input, else from Claude's last Write to a plan file */
  plan?: string | null;
};
export type Usage = { fiveHour: number | null; sevenDay: number | null; resetsAt: number | null };

export type RunState = {
  /** working: a turn runs · permission: waits for Allow/Deny · idle: waits for the user */
  status: "idle" | "working" | "permission";
  model: string | null;
  /** last text Claude said in this process */
  lastText: string | null;
  permission: Permission | null;
  /** subscription windows as utilisation 0..1, when the CLI reports them */
  usage: Usage | null;
  /** error of the last turn, null when it went fine */
  error: string | null;
  /** the last plan Claude wrote to `.claude/plans/` (newer CLIs send ExitPlanMode without the plan) */
  planText?: string | null;
};

export const initialRun = (): RunState => ({ status: "idle", model: null, lastText: null, permission: null, usage: null, error: null });

/** Content of a Write to a plan file in an assistant message, if any. */
function planWritten(content: any[]): string | null {
  const w = content.findLast((b: any) => b?.type === "tool_use" && b.name === "Write" && /[/\\]\.claude[/\\]plans[/\\][^/\\]+\.md$/.test(String(b.input?.file_path ?? "")));
  return typeof w?.input?.content === "string" ? w.input.content : null;
}

/** The questions of an AskUserQuestion input, in a fixed shape. */
function questionsOf(input: any): Question[] {
  return (Array.isArray(input?.questions) ? input.questions : []).map((q: any) => ({
    question: String(q?.question ?? ""),
    header: String(q?.header ?? ""),
    multiSelect: q?.multiSelect === true,
    options: (Array.isArray(q?.options) ? q.options : []).map((o: any) => ({ label: String(o?.label ?? ""), description: String(o?.description ?? "") })),
  }));
}

export type StreamEvent =
  | { kind: "state"; state: RunState }
  /** the turn ended; the next queued message may go */
  | { kind: "turn-end"; state: RunState };

/** Applies one stdout line. Unknown or broken lines leave the state as it is (the format may grow). */
export function applyLine(state: RunState, line: string): StreamEvent {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return { kind: "state", state };
  }
  switch (m?.type) {
    case "system":
      if (m.subtype === "init") return { kind: "state", state: { ...state, status: "working", model: m.model ?? state.model, error: null } };
      return { kind: "state", state };
    case "assistant": {
      const content = Array.isArray(m.message?.content) ? m.message.content : [];
      const joined = content
        .filter((b: any) => b?.type === "text" && typeof b.text === "string" && b.text.trim())
        .map((b: any) => b.text.trim())
        .join("\n");
      const text = splitTitle(joined).rest.trim();
      const plan = planWritten(content);
      // an open request stays open: a parallel tool's or a subagent's message can arrive while Claude asks
      const next: RunState = { ...state, status: state.permission ? "permission" : "working",...(text ? { lastText: text } : {}), ...(plan ? { planText: plan } : {}) };
      return { kind: "state", state: next };
    }
    case "control_request": {
      if (m.request?.subtype !== "can_use_tool") return { kind: "state", state };
      const tool = String(m.request.tool_name ?? "");
      const input = m.request.input ?? {};
      const kind = tool === "AskUserQuestion" ? "question" : tool === "ExitPlanMode" ? "plan" : "permission";
      const permission: Permission = {
        requestId: String(m.request_id),
        tool: String(m.request.display_name ?? (tool || "Tool")),
        description: String(m.request.description ?? ""),
        input,
        kind,
        ...(kind === "question" ? { questions: questionsOf(input) } : {}),
        ...(kind === "plan" ? { plan: typeof input.plan === "string" ? input.plan : state.planText ?? null } : {}),
      };
      return { kind: "state", state: { ...state, status: "permission", permission } };
    }
    case "rate_limit_event": {
      const w = m.rate_limit_info?.unifiedWindows ?? {};
      const usage = { fiveHour: w.five_hour?.utilization ?? null, sevenDay: w.seven_day?.utilization ?? null, resetsAt: m.rate_limit_info?.resetsAt ?? null };
      return { kind: "state", state: { ...state, usage } };
    }
    case "result": {
      const error = m.is_error ? `Turn failed: ${String(m.result ?? m.subtype ?? "unknown").slice(0, 200)}` : null;
      const result = typeof m.result === "string" ? splitTitle(m.result).rest.trim() : "";
      const lastText = !m.is_error && result ? result : state.lastText;
      return { kind: "turn-end", state: { ...state, status: "idle", permission: null, error, lastText } };
    }
    default:
      return { kind: "state", state };
  }
}

/** A message from the user, as the CLI reads it on stdin. */
export const userLine = (text: string, images: { mediaType: string; data: string }[] = []) =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      // images as content blocks before the text (probed 2026-11-22, ADR-0021)
      content: images.length
        ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })), { type: "text", text }]
        : text,
    },
  });

/**
 * The user's answer to a permission request. A question is answered by allowing it with `answers` (question text →
 * chosen label, several joined with ", "), as the CLI expects (probed 2026-11-23, ADR-0028).
 */
export const permissionLine = (p: Permission, allow: boolean, message?: string, answers?: Record<string, string>) =>
  JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: p.requestId,
      response: allow
        ? { behavior: "allow", updatedInput: answers ? { ...p.input, answers } : p.input }
        : { behavior: "deny", message: message || "Denied by the user." },
    },
  });

/** What the session asks, as a short line (attention text). */
export function askText(p: Permission): string {
  if (p.kind === "plan") return "Plan to approve";
  if (p.kind === "question") return `Asks: ${p.questions?.[0]?.question || "Question"}${(p.questions?.length ?? 0) > 1 ? ` (+${p.questions!.length - 1})` : ""}`;
  return `Asks: ${p.tool}`;
}
