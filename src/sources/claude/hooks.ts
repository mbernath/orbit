// Hook intake of the Claude source: one Claude Code hook event updates one session row (ADR-0005).
import { dirname } from "node:path";
import type { CoreContext } from "../../core/types";
import { oneLine, splitTitle, truncate } from "../../core/util";
import { branchesOf, ownBranches } from "./branches";
import { todoProgress, waitReason } from "./entries";
import { lastAssistantText, readAiTitle } from "./transcripts";

export type HookInput = {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  prompt?: string;
  message?: string;
  /** Notification: e.g. "permission_prompt", "idle_prompt" */
  notification_type?: string;
  last_assistant_message?: string;
  /** PermissionRequest: the tool and its input (e.g. the Bash command) */
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

export const sessionRef = (id: string) => `session:claude/${id}`;

/** Branches the session worked on itself, from its transcript (ADR-0024). */
export function refreshOwnBranches(ctx: CoreContext, id: string, transcript: string | null | undefined) {
  const own = ownBranches(transcript);
  ctx.db.run(`UPDATE claude_sessions SET own_branches = ? WHERE id = ?`, [own.length ? JSON.stringify(own) : null, id]);
}

/** A Bash step that created, pushed or opened a PR for a branch links it at once, not only at the turn's Stop. */
function addOwnBranches(ctx: CoreContext, id: string, command: unknown, current: string | null) {
  if (typeof command !== "string") return;
  const found = branchesOf(command, current);
  if (!found.length) return;
  const row = ctx.db.query(`SELECT own_branches FROM claude_sessions WHERE id = ?`).get(id) as { own_branches: string | null } | null;
  const own: string[] = row?.own_branches ? JSON.parse(row.own_branches) : [];
  const next = [...own, ...found.filter((b) => !own.includes(b))];
  if (next.length > own.length) ctx.db.run(`UPDATE claude_sessions SET own_branches = ? WHERE id = ?`, [JSON.stringify(next), id]);
}

/** Claude Code's own "needs your permission" notice (older versions send no notification_type). */
const isPermissionNotice = (i: HookInput) => i.notification_type === "permission_prompt" || /needs your permission/i.test(i.message ?? "");

/** JSON with sorted keys, so the same input compares equal whatever order Claude Code wrote it in. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`
  : JSON.stringify(v) ?? "null";

/** The tool a hook is about: name plus input (PermissionRequest carries no tool_use_id). */
const toolKey = (i: HookInput) => JSON.stringify({ name: i.tool_name ?? null, input: i.tool_input ? canonical(i.tool_input) : null });

/** Whether a PostToolUse is the tool the open prompt asked for. Without a recorded prompt (waiting from a notice only),
 *  or without input on either side, the tool name decides. */
export function endsWait(pending: string | null, post: HookInput): boolean {
  if (!pending) return true;
  const p = JSON.parse(pending) as { name: string | null; input: string | null };
  if (p.name !== (post.tool_name ?? null)) return false;
  return !p.input || !post.tool_input || p.input === canonical(post.tool_input);
}

/** @param gitTop top of the current checkout; undefined when an older hook did not send it */
export function handleHook(ctx: CoreContext, input: HookInput, gitCommon: string | null, branch: string | null, gitTop?: string | null) {
  const id = input.session_id;
  const type = input.hook_event_name;
  if (!id || !type) return false;
  const sql = (query: string, ...params: any[]) => ctx.db.run(query, params);
  const now = Date.now();
  // git-common-dir points at the main repo's .git, also from inside a worktree.
  const gitRoot = gitCommon ? dirname(gitCommon) : null;
  ctx.log("claude", `hook.${type}`, sessionRef(id), input);
  sql(
    `INSERT INTO claude_sessions (id, cwd, git_root, branch, status, transcript_path, acknowledged, started_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'idle', ?5, 1, ?6, ?6)
     ON CONFLICT(id) DO UPDATE SET cwd = COALESCE(?2, cwd), git_root = COALESCE(?3, git_root),
       branch = COALESCE(?4, branch), transcript_path = COALESCE(?5, transcript_path), updated_at = ?6`,
    id, input.cwd ?? null, gitRoot, branch && branch !== "HEAD" ? branch : null, input.transcript_path ?? null, now,
  );
  // a worktree is a checkout whose top is not the main repo; a session can move in and out of one (ADR-0017)
  if (gitTop !== undefined) sql(`UPDATE claude_sessions SET work_tree = ? WHERE id = ?`, gitTop && gitRoot && gitTop !== gitRoot ? gitTop : null, id);
  ctx.canvas.unarchive(sessionRef(id)); // a session that is used again comes back from the archive

  const status = (s: string, ack: 0 | 1, msg: string | null = null) =>
    sql(
      // a pending question only lives while the session waits
      `UPDATE claude_sessions SET status = ?1, acknowledged = ?2, updated_at = ?3, last_message = COALESCE(?4, last_message),
         question = CASE WHEN ?1 = 'waiting' THEN question ELSE NULL END,
         pending_tool = CASE WHEN ?1 = 'waiting' THEN pending_tool ELSE NULL END WHERE id = ?5`,
      s, ack, now, msg ? truncate(msg, 500) : null, id,
    );
  const refreshAiTitle = () => {
    const t = readAiTitle(input.transcript_path);
    if (t) sql(`UPDATE claude_sessions SET ai_title = ? WHERE id = ?`, t, id);
  };

  switch (type) {
    case "SessionStart":
      status("idle", 1);
      break;
    case "UserPromptSubmit":
      if (input.prompt) sql(`UPDATE claude_sessions SET title = ? WHERE id = ? AND title IS NULL`, truncate(oneLine(input.prompt), 90), id);
      refreshAiTitle();
      status("working", 1);
      break;
    case "PermissionRequest": {
      // the concrete question, read only: Orbit answers nothing here, the dialog in VS Code or the terminal stays
      const why = waitReason(input.tool_name, input.tool_input); // permission, question or plan (ADR-0027)
      sql(`UPDATE claude_sessions SET question = ?, question_kind = ?, pending_tool = ? WHERE id = ?`, why.text, why.kind, toolKey(input), id);
      status("waiting", 0);
      break;
    }
    case "Notification":
      // a permission notice is no statement of Claude's: the question row shows it; keep the last real words
      status("waiting", 0, isPermissionNotice(input) ? null : input.message ?? "Waiting for input");
      break;
    case "PostToolUse": {
      if (input.tool_name === "Bash") addOwnBranches(ctx, id, input.tool_input?.command, branch);
      if (input.tool_name === "TodoWrite") {
        const p = todoProgress(input.tool_input);
        sql(`UPDATE claude_sessions SET progress = ? WHERE id = ?`, p ? JSON.stringify(p) : null, id);
      }
      // the asked tool ran — the permission was granted (here or in VS Code), the session works again (no other hook says
      // so before the turn ends). A parallel tool finishing while the prompt is open says nothing about it.
      // Only leaves "waiting", never overrides another state.
      const row = ctx.db.query(`SELECT status, pending_tool FROM claude_sessions WHERE id = ?`).get(id) as { status: string; pending_tool: string | null } | null;
      if (row?.status === "waiting" && endsWait(row.pending_tool, input)) status("working", 1);
      break;
    }
    case "Stop":
      // Claude Code writes the topic title asynchronously, usually during the first turn.
      refreshAiTitle();
      refreshOwnBranches(ctx, id, input.transcript_path);
      status("done", 0, (input.last_assistant_message ? splitTitle(input.last_assistant_message).rest.trim() || null : null) ?? lastAssistantText(input.transcript_path));
      ctx.publish({ type: "session.done", sessionId: id, cwd: input.cwd ?? null }); // ADR-0020
      break;
    case "SessionEnd":
      status("inactive", 1);
      break;
  }
  ctx.emit();
  return true;
}
