// Owned sessions (ADR-0010, ADR-0019): sessions Orbit runs itself through `claude -p` with the user's own login.
// This source only steers; the session itself (title, transcript, status from hooks) stays with the claude source.
// Its `control` entity carries the key claude:<id>, so the board finds it next to the session (ADR-0008).
import { existsSync, statSync } from "node:fs";
import type { ActionDefinition, CoreContext, Entity, Source } from "../../core/types";
import { expandHome, isWithinPath, truncate } from "../../core/util";
import { type Attachment, checkAttachments, prepareAttachments } from "./attachments";
import { childEnv, createOwnedSession, type OwnedSession } from "./session";
import { createDefaults, defaultsMigration } from "./defaults";
import { createWorktree, removeWorktree } from "./worktree";
import { askText } from "./stream";

type Row = {
  id: string; cwd: string; model: string | null; effort: string | null; taken_over: number;
  /** last known run status, so a restart can tell which sessions were interrupted */
  run_status: string; created_at: number; updated_at: number;
  /** worktree Orbit created for this session (ADR-0017), and the repo it belongs to */
  worktree: string | null; repo: string | null;
  /** agent this session is a run of (ADR-0015), else null */
  agent: string | null;
  /** permission mode for the CLI, null = its default (asks) */
  mode: string | null;
};

export const MODELS = ["opus", "sonnet", "haiku"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** permission modes Orbit offers; never bypassPermissions (ADR-0019) */
export const MODES = ["acceptEdits", "plan", "auto", "dontAsk"] as const;

/** @param opts.claudeHome Claude Code's settings folder, read for run defaults (ADR-0025); default ~/.claude */
export function createOwnedSource(opts: { bin?: string; claudeHome?: string } = {}): Source {
  let ctx: CoreContext;
  const live = new Map<string, OwnedSession>();
  /** sessions that were running when Orbit stopped; cleared by the next message */
  const interrupted = new Set<string>();
  /** set on shutdown: ending processes must not write any more (and must keep "was mid-turn" for the next start) */
  let stopped = false;

  const rows = () => ctx.db.query(`SELECT * FROM owned_sessions ORDER BY created_at`).all() as Row[];
  const row = (id: string) => ctx.db.query(`SELECT * FROM owned_sessions WHERE id = ?`).get(id) as Row | null;
  const touch = (id: string) =>
    ctx.db.run(`UPDATE owned_sessions SET updated_at = ?, run_status = ? WHERE id = ?`, [Date.now(), live.get(id)?.state.status ?? "idle", id]);

  /** sessions whose model, effort or mode changed while their process was busy; it ends once the turn is over */
  const outdated = new Set<string>();

  /** Ends an idle process so the next message starts one with the stored settings; else waits for the turn to end. */
  function restartIfIdle(id: string) {
    const s = live.get(id);
    if (!s) return void outdated.delete(id);
    if (s.state.permission || s.state.status !== "idle" || s.queued) return void outdated.add(id);
    outdated.delete(id);
    live.delete(id);
    void s.stop();
  }

  /** @param fresh created by owned.start just now: the CLI does not know the id yet; every other session is resumed */
  function session(r: Row, fresh = false): OwnedSession {
    let s = live.get(r.id);
    if (s) return s;
    s = createOwnedSession(
      runSpec(r),
      {
        spawn: ctx.spawn,
        bin: opts.bin ?? "claude",
        env: childEnv(process.env),
        resume: !fresh,
        onChange: () => {
          if (stopped) return;
          touch(r.id);
          ctx.emit();
          if (outdated.has(r.id)) restartIfIdle(r.id);
        },
      },
    );
    live.set(r.id, s);
    return s;
  }

  /** Sends a message with its attachments: images inline, other files stored and named by path (ADR-0021). */
  function sendWith(s: OwnedSession, id: string, text: string, attachments?: Attachment[]) {
    const { images, lines } = prepareAttachments(ctx.home, id, attachments);
    s.send([text.trim(), ...lines].join("\n\n"), images);
  }

  /** Problem text when cwd is not an existing folder inside a workspace, else null. */
  function checkCwd(cwd: unknown): string | null {
    if (typeof cwd !== "string" || !cwd.trim()) return "Folder missing.";
    const p = expandHome(cwd);
    if (!existsSync(p) || !statSync(p).isDirectory()) return "Folder not found.";
    const inside = ctx.workspaces.list().some((w) => w.paths.some((root) => isWithinPath(p, expandHome(root))));
    return inside ? null : "The folder isn't in any island.";
  }
  const checkModel = (i: { model?: unknown; effort?: unknown; mode?: unknown }) =>
    i.model != null && !MODELS.includes(i.model as any)
      ? "Unknown model."
      : i.effort != null && !EFFORTS.includes(i.effort as any)
        ? "Unknown effort."
        : i.mode != null && !MODES.includes(i.mode as any)
          ? "Unknown mode."
          : null;
  const known = (i: { id?: unknown }) => (typeof i?.id !== "string" ? "Session missing." : row(i.id) ? null : "This session doesn't run in Orbit.");
  const defaults = createDefaults(() => ctx, opts.claudeHome ?? expandHome("~/.claude"), checkModel);

  /** What the CLI gets: the session's own choice, else what is set for its island; Claude's settings it reads itself. */
  function runSpec(r: Row) {
    const d = defaults.forFolder(r.cwd);
    const mode = r.mode ?? d.island.mode ?? (d.effective.mode === "default" ? "default" : null); // never bypass (ADR-0019)
    return { id: r.id, cwd: r.cwd, model: r.model ?? d.island.model, effort: r.effort ?? d.island.effort, mode };
  }

  function insert(id: string, cwd: string, model: string | null, effort: string | null, takenOver: boolean) {
    const now = Date.now();
    ctx.db.run(
      `INSERT INTO owned_sessions (id, cwd, model, effort, taken_over, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, expandHome(cwd), model, effort, takenOver ? 1 : 0, now, now],
    );
  }

  const actions: ActionDefinition[] = [
    {
      // New session in a folder of an island, with its first message.
      id: "owned.start",
      risk: "local",
      allowedActors: ["board", "system"], // agents start their runs (ADR-0020)
      validate: (i: { cwd?: unknown; text?: unknown; model?: unknown; effort?: unknown; mode?: unknown; attachments?: unknown }) =>
        checkCwd(i?.cwd) ?? (typeof i.text === "string" && i.text.trim() ? null : "Message missing.") ?? checkModel(i) ?? checkAttachments(i.attachments),
      // worktree: true → its own worktree on a new branch instead of the main checkout (ADR-0017)
      // agent: the run belongs to this agent (ADR-0015); the board shows it inside the agent
      // attachments: images inline, other files stored and named by path (ADR-0021)
      async run(i: { cwd: string; text: string; model?: string; effort?: string; mode?: string; worktree?: boolean; agent?: string; attachments?: Attachment[] }) {
        const id = crypto.randomUUID();
        let cwd = i.cwd;
        if (i.worktree === true) {
          const w = await createWorktree(ctx.run, expandHome(i.cwd), i.text);
          if ("error" in w) return { ok: false, status: 400, error: w.error };
          cwd = w.path;
          insert(id, cwd, i.model ?? null, i.effort ?? null, false);
          ctx.db.run(`UPDATE owned_sessions SET worktree = ?, repo = ? WHERE id = ?`, [w.path, w.repo, id]);
        } else insert(id, cwd, i.model ?? null, i.effort ?? null, false);
        if (typeof i.agent === "string") ctx.db.run(`UPDATE owned_sessions SET agent = ? WHERE id = ?`, [i.agent, id]);
        if (i.mode) ctx.db.run(`UPDATE owned_sessions SET mode = ? WHERE id = ?`, [i.mode, id]);
        sendWith(session(row(id) as Row, true), id, i.text, i.attachments);
        ctx.log("owned", "start", `session:claude/${id}`, { cwd: i.cwd, model: i.model ?? null, agent: i.agent ?? null });
        ctx.emit();
        return { ok: true, data: { id, ref: `session:claude/${id}` } };
      },
    },
    {
      // Take over a session another program ran: from now on Orbit resumes it (ADR-0010). Asks first, because the
      // original program may still have it open and two writers lose messages.
      id: "owned.takeover",
      risk: "irreversible",
      allowedActors: ["board"],
      validate: (i: { id?: unknown; cwd?: unknown }) =>
        typeof i?.id !== "string" ? "Session missing." : row(i.id) ? "Already runs in Orbit." : checkCwd(i.cwd),
      run(i: { id: string; cwd: string }) {
        insert(i.id, i.cwd, null, null, true);
        ctx.emit();
        return { ok: true };
      },
    },
    {
      id: "owned.send",
      risk: "local",
      allowedActors: ["board", "system"],
      validate: (i: { id?: unknown; text?: unknown; attachments?: unknown }) =>
        known(i) ?? (typeof i.text === "string" && i.text.trim() ? null : "Message missing.") ?? checkAttachments(i.attachments),
      run(i: { id: string; text: string; attachments?: Attachment[] }) {
        interrupted.delete(i.id);
        sendWith(session(row(i.id) as Row), i.id, i.text, i.attachments);
        return { ok: true };
      },
    },
    {
      // Allow / Deny for a pending permission request; a question's chosen options as answers (ADR-0028).
      id: "owned.answer",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: unknown; allow?: unknown; answers?: unknown }) =>
        known(i) ?? (typeof i.allow !== "boolean" ? "Answer missing."
          : i.answers !== undefined && (typeof i.answers !== "object" || !i.answers || Object.values(i.answers).some((v) => typeof v !== "string"))
            ? "Answers must be text." : null),
      run(i: { id: string; allow: boolean; message?: string; answers?: Record<string, string> }) {
        // a question allowed without an answer would leave Claude guessing
        const asked = live.get(i.id)?.state.permission;
        if (asked?.kind === "question" && i.allow && !Object.keys(i.answers ?? {}).length) return { ok: false, status: 400, error: "Choose an answer." };
        const ok = live.get(i.id)?.answer(i.allow, typeof i.message === "string" ? i.message : undefined, i.answers);
        return ok ? { ok: true } : { ok: false, status: 409, error: "Nothing is waiting for an answer." };
      },
    },
    {
      // Model, effort and mode for the next turns (ADR-0017); a busy process finishes its turn, then ends, so the next message uses them.
      id: "owned.configure",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: unknown; model?: unknown; effort?: unknown; mode?: unknown }) => known(i) ?? checkModel(i),
      async run(i: { id: string; model?: string | null; effort?: string | null; mode?: string | null }) {
        const r = row(i.id) as Row;
        const keep = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
        ctx.db.run(`UPDATE owned_sessions SET model = ?, effort = ?, mode = ? WHERE id = ?`, [
          keep(i.model, r.model), keep(i.effort, r.effort), keep(i.mode, r.mode), i.id,
        ]);
        restartIfIdle(i.id);
        ctx.emit();
        return { ok: true };
      },
    },
    {
      // "Also remove worktree", offered when the session is taken off the board; never automatic (ADR-0017).
      id: "owned.removeWorktree",
      risk: "irreversible",
      allowedActors: ["board"],
      validate: (i: { id?: unknown }) => known(i) ?? (row(i.id as string)?.worktree ? null : "This session has no separate worktree."),
      async run(i: { id: string }) {
        const r = row(i.id) as Row;
        await live.get(i.id)?.stop();
        live.delete(i.id);
        const error = await removeWorktree(ctx.run, { path: r.worktree as string, repo: r.repo as string });
        if (error) return { ok: false, status: 409, error };
        ctx.db.run(`UPDATE owned_sessions SET worktree = NULL WHERE id = ?`, [i.id]);
        ctx.emit();
        return { ok: true };
      },
    },
    {
      // Stop (ADR-0044): interrupts the running turn, keeps the process and the session; queued messages come back
      // to the board, which puts them into the reply field again.
      id: "owned.stop",
      risk: "local",
      allowedActors: ["board"],
      validate: known,
      async run(i: { id: string }) {
        const dropped = (await live.get(i.id)?.interrupt()) ?? [];
        await ctx.act("claude.stopped", { id: i.id }); // no Stop hook comes for an interrupt
        ctx.emit();
        return { ok: true, data: { dropped } };
      },
    },
  ];

  function toEntity(r: Row): Entity {
    const s = live.get(r.id);
    const st = s?.state;
    const status = interrupted.has(r.id) ? "interrupted" : st?.status ?? "idle";
    const p = st?.permission ?? null;
    return {
      ref: `control:owned/${r.id}`,
      kind: "control",
      source: "owned",
      title: "",
      status,
      workspaceId: null,
      paths: [r.cwd],
      keys: [`claude:${r.id}`, ...(r.agent ? [`agent:${r.agent}`] : [])],
      attention: p ? { level: "waiting", text: askText(p) } : st?.error ? { level: "fail", text: "Error" } : null,
      parent: null,
      updatedAt: r.updated_at,
      actions: ["owned.send", "owned.configure", "owned.stop", ...(p ? ["owned.answer"] : []), ...(r.worktree ? ["owned.removeWorktree"] : [])],
      data: {
        id: r.id,
        cwd: r.cwd,
        model: r.model,
        effort: r.effort,
        mode: r.mode,
        runningModel: st?.model ?? null,
        /** what applies where the session leaves a value open (ADR-0025) */
        defaults: defaults.forFolder(r.cwd).effective,
        takenOver: r.taken_over === 1,
        worktree: r.worktree,
        agent: r.agent,
        running: s?.running ?? false,
        queued: s?.queued ?? 0,
        lastText: st?.lastText ?? null,
        /** what the running turn does and since when (ADR-0044) */
        activity: st?.status === "working" ? st.activity ?? "Working" : null,
        since: s?.since ?? null,
        permission: p && {
          tool: p.tool, description: p.description, detail: truncate(JSON.stringify(p.input), 300),
          kind: p.kind, questions: p.questions ?? null, plan: p.plan ?? null, // ADR-0028
        },
        usage: st?.usage ?? null,
        error: st?.error ?? null,
      },
    };
  }

  return {
    id: "owned",
    migrations: [
      {
        version: 1,
        up: (db) =>
          db.exec(`CREATE TABLE owned_sessions (
            id TEXT PRIMARY KEY, cwd TEXT NOT NULL, model TEXT, effort TEXT,
            taken_over INTEGER NOT NULL DEFAULT 0, run_status TEXT NOT NULL DEFAULT 'idle', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
      },
      {
        version: 2, // own worktree (ADR-0017)
        up: (db) => db.exec(`ALTER TABLE owned_sessions ADD COLUMN worktree TEXT; ALTER TABLE owned_sessions ADD COLUMN repo TEXT;`),
      },
      {
        version: 3, // runs of agents (ADR-0015, ADR-0020)
        up: (db) => db.exec(`ALTER TABLE owned_sessions ADD COLUMN agent TEXT`),
      },
      {
        version: 4, // permission mode: matters as much as model and effort
        up: (db) => db.exec(`ALTER TABLE owned_sessions ADD COLUMN mode TEXT`),
      },
      defaultsMigration,
    ],
    actions: [...actions, defaults.action],
    routes: [],
    async start(c) {
      ctx = c;
      // Orbit restarted: no process survives. Sessions that were mid-turn are marked interrupted.
      for (const r of rows()) if (r.run_status !== "idle") interrupted.add(r.id);
    },
    entities: () => [...rows().map(toEntity), ...defaults.entities()],
    async stop() {
      stopped = true;
      await Promise.all([...live.values()].map((s) => s.stop()));
    },
  };
}
