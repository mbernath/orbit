// Claude Code source: live sessions through hooks, existing ones from transcripts (ADR-0003, ADR-0005).
// Entities: `session:claude/<session id>`.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActionDefinition, CoreContext, Entity, Route, Source } from "../../core/types";
import { isWithinPath, oneLine, problem, truncate } from "../../core/util";
import { claudeMigrations } from "./migrations";
import { handleHook, type HookInput, refreshOwnBranches, sessionRef } from "./hooks";
import { readHookCheck } from "./hook-setup";
import { type ProjectFolder, readProjectFolders, suggestFolders } from "./folders";
import { findTranscripts, isWithin, parseTranscript, readConversation } from "./transcripts";

type Row = {
  id: string; cwd: string | null; git_root: string | null; branch: string | null; status: string;
  title: string | null; ai_title: string | null; custom_title: string | null; last_message: string | null;
  transcript_path: string | null; acknowledged: number; started_at: number; updated_at: number;
  work_tree: string | null;
  /** the pending permission question ("Bash npm test"), while the session waits */
  question: string | null;
  /** JSON list of branches the session worked on itself (ADR-0024) */
  own_branches: string | null;
  /** what kind of wait the question is (ADR-0027): "permission", "question" or "plan" */
  question_kind: string | null;
  /** JSON TodoProgress of the last TodoWrite (ADR-0027) */
  progress: string | null;
};

export { sessionRef };
const idOf = (ref: string) => (ref.startsWith("session:claude/") ? ref.slice("session:claude/".length) : null);

export function createClaudeSource(opts: { projectsDir?: string; claudeHome?: string; importMs?: number } = {}): Source {
  let timer: ReturnType<typeof setInterval> | null = null;
  const projectsDir = opts.projectsDir ?? join(homedir(), ".claude", "projects");
  const claudeHome = opts.claudeHome ?? join(homedir(), ".claude");
  let ctx: CoreContext;
  const sql = (query: string, ...params: any[]) => ctx.db.run(query, params);

  /**
   * Keys that link the session to PRs (ADR-0024): in its own worktree the branch is its own; in the shared main
   * checkout only branches it created, pushed or opened a PR for — the checkout's current branch is everyone's.
   */
  function prKeys(s: Row, repo: string | null): string[] {
    if (!repo) return [];
    // a worktree: reported by the hook, or the session works outside the main repo (older hooks, Conductor)
    const worktree = !!s.work_tree || (!!s.cwd && !!s.git_root && !isWithinPath(s.cwd, s.git_root));
    if (worktree) return s.branch ? [`git:${repo}#${s.branch}`] : [];
    const own: string[] = s.own_branches ? JSON.parse(s.own_branches) : [];
    return own.map((b) => `git:${repo}#${b}`);
  }

  // ---------- Transcript import (ADR-0003) ----------

  function importSessions(paths: string[]) {
    let count = 0;
    for (const file of findTranscripts(projectsDir, paths)) {
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const seen = ctx.db.query(`SELECT mtime, size FROM claude_imported_files WHERE path = ?`).get(file) as
        | { mtime: number; size: number }
        | null;
      if (seen && seen.mtime === st.mtimeMs && seen.size === st.size) continue;
      const info = parseTranscript(file);
      if (info && isWithin(info.cwd, paths)) {
        // Hook data wins: an existing row only gets empty fields filled; status stays.
        sql(
          `INSERT INTO claude_sessions (id, cwd, branch, status, title, ai_title, last_message, transcript_path, acknowledged, started_at, updated_at)
           VALUES (?1, ?2, ?3, 'inactive', ?4, ?5, ?6, ?7, 1, ?8, ?9)
           ON CONFLICT(id) DO UPDATE SET
             title = COALESCE(title, ?4), ai_title = COALESCE(?5, ai_title), branch = COALESCE(branch, ?3),
             last_message = COALESCE(last_message, ?6), transcript_path = COALESCE(transcript_path, ?7),
             cwd = COALESCE(cwd, ?2), started_at = MIN(started_at, ?8),
             updated_at = CASE WHEN status = 'inactive' THEN MAX(updated_at, ?9) ELSE updated_at END`,
          info.id, info.cwd, info.branch, info.firstPrompt, info.aiTitle, info.lastMessage, file, info.startedAt, info.updatedAt,
        );
        refreshOwnBranches(ctx, info.id, file);
        count++;
      }
      sql(
        `INSERT INTO claude_imported_files (path, mtime, size) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size`,
        file, st.mtimeMs, st.size,
      );
    }
    if (count) ctx.emit();
    return count;
  }
  /** project folders for the first-run suggestions (ADR-0041), read again with every full import */
  let folders: ProjectFolder[] | null = null;
  const importAll = () => ((folders = null), importSessions(ctx.workspaces.list().flatMap((w) => w.paths)));

  // ---------- Entities ----------

  function toEntity(s: Row): Entity {
    const unseen = !s.acknowledged && (s.status === "waiting" || s.status === "done");
    const attention = !unseen
      ? null
      : s.status === "waiting"
        ? { level: "waiting" as const, text: "waiting" }
        : { level: "done" as const, text: "done" };
    const repo = s.git_root ?? s.cwd;
    return {
      ref: sessionRef(s.id),
      kind: "session",
      source: "claude",
      title: s.custom_title ?? s.ai_title ?? s.title ?? "New session",
      status: s.status,
      workspaceId: null,
      paths: [s.git_root, s.cwd].filter((p): p is string => !!p),
      // claude:<id> links what other sources know about the same session (e.g. Orbit running it, ADR-0019)
      keys: [`claude:${s.id}`, ...prKeys(s, repo)],
      attention,
      parent: null,
      updatedAt: s.updated_at,
      actions: ["claude.rename", ...(attention ? ["claude.ack"] : [])],
      data: {
        id: s.id,
        cwd: s.cwd,
        gitRoot: s.git_root,
        workTree: s.work_tree, // own worktree, or null for the main checkout (ADR-0017)
        question: s.status === "waiting" ? s.question : null, // e.g. "Bash npm test" — answered where the session runs
        questionKind: s.status === "waiting" && s.question ? (s.question_kind ?? "permission") : null, // ADR-0027
        progress: s.progress ? JSON.parse(s.progress) : null, // last TodoWrite: { done, total, current }
        branch: s.branch,
        lastMessage: s.last_message,
        autoTitle: s.ai_title ?? s.title, // what a reset of the custom title falls back to
        customTitle: s.custom_title,
        startedAt: s.started_at,
      },
    };
  }

  // ---------- Actions and routes ----------

  const hasId = (i: { id?: unknown }) => (typeof i?.id === "string" ? null : "Session missing.");

  const actions: ActionDefinition[] = [
    {
      id: "claude.rename",
      risk: "local",
      allowedActors: ["board"],
      validate: hasId,
      run(i: { id: string; title?: string | null }) {
        const t = typeof i.title === "string" ? oneLine(i.title) : "";
        sql(`UPDATE claude_sessions SET custom_title = ? WHERE id = ?`, t ? truncate(t, 120) : null, i.id);
        return { ok: true };
      },
    },
    {
      id: "claude.ack",
      risk: "local",
      allowedActors: ["board"],
      validate: hasId,
      run(i: { id: string }) {
        sql(`UPDATE claude_sessions SET acknowledged = 1 WHERE id = ?`, i.id);
        return { ok: true };
      },
    },
    {
      // The user stopped the turn of a session Orbit runs (ADR-0044). Claude Code sends no Stop hook for an interrupt,
      // so without this the session would read "working" until its next turn. Idle and seen: nothing new to look at.
      id: "claude.stopped",
      risk: "local",
      allowedActors: ["system"],
      validate: hasId,
      run(i: { id: string }) {
        sql(`UPDATE claude_sessions SET status = 'idle', acknowledged = 1, question = NULL, pending_tool = NULL, updated_at = ? WHERE id = ? AND status IN ('working', 'waiting')`, Date.now(), i.id);
        return { ok: true };
      },
    },
    {
      id: "claude.import",
      risk: "local",
      allowedActors: ["board", "system"],
      run: () => ({ ok: true, data: { imported: importAll() } }),
    },
  ];

  const routes: Route[] = [
    {
      method: "POST",
      path: "/events",
      auth: "hook",
      async handle(req) {
        const body = (await req.json().catch(() => null)) as HookInput | null;
        const h = (name: string) => req.headers.get(name) || null;
        const top = req.headers.has("x-orbit-git-top") ? h("x-orbit-git-top") : undefined;
        const ok = !!body && handleHook(ctx, body, h("x-orbit-git-common"), h("x-orbit-branch"), top);
        return ok ? new Response(null, { status: 204 }) : problem(400, "Invalid hook event.");
      },
    },
    {
      // The end of a session's conversation for the detail panel: GET /api/conversation?id=<session id>
      method: "GET",
      path: "/api/conversation",
      auth: "none",
      handle(req) {
        const id = new URL(req.url).searchParams.get("id") ?? "";
        const row = ctx.db.query(`SELECT transcript_path FROM claude_sessions WHERE id = ?`).get(id) as { transcript_path: string | null } | null;
        if (!row) return problem(404, "Session not found.");
        return Response.json(readConversation(row.transcript_path));
      },
    },
    {
      // Hook events the installed Orbit hook lacks (ADR-0031): GET /api/claude/hooks → { missing: string[] }
      method: "GET",
      path: "/api/claude/hooks",
      auth: "none",
      handle: () => Response.json(readHookCheck(claudeHome)),
    },
    {
      // Island suggestions for the empty board (ADR-0041): GET /api/claude/folders → FolderSuggestion[]
      method: "GET",
      path: "/api/claude/folders",
      auth: "none",
      handle: () => Response.json(suggestFolders((folders ??= readProjectFolders(projectsDir)), ctx.workspaces.list().flatMap((w) => w.paths))),
    },
  ];

  return {
    id: "claude",
    migrations: claudeMigrations,
    actions,
    routes,
    start(c) {
      ctx = c;
      c.on((e) => {
        if (e.type === "workspaces.changed" && e.paths.length) importSessions(e.paths);
        // An archived session never waits in "Needs you" (ADR-0005).
        if (e.type === "element.archived") {
          const id = idOf(e.ref);
          if (id) sql(`UPDATE claude_sessions SET acknowledged = 1 WHERE id = ?`, id);
        }
      });
      try {
        importAll();
      } catch (err) {
        console.error("Importing existing sessions failed:", err);
      }
      // sessions from before ADR-0024 (or whose transcript import was skipped as unchanged) get their own branches once
      for (const s of ctx.db.query(`SELECT id, transcript_path FROM claude_sessions WHERE own_branches IS NULL AND transcript_path IS NOT NULL`).all() as
        { id: string; transcript_path: string }[]) refreshOwnBranches(ctx, s.id, s.transcript_path);
      // Hook events can get lost (machine asleep, offline, server busy): changed transcripts are read again, so a
      // branch pushed or a PR opened in a lost turn still links its session. Unchanged files are skipped by mtime/size.
      const every = opts.importMs ?? 60_000;
      if (every > 0)
        timer = setInterval(() => {
          try {
            importAll();
          } catch (err) {
            console.error("Importing sessions failed:", err);
          }
        }, every);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    entities: () =>
      (ctx.db.query(`SELECT * FROM claude_sessions ORDER BY updated_at DESC`).all() as Row[]).map(toEntity),
  };
}
