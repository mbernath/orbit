// Agents (ADR-0015, ADR-0016, ADR-0020): a lasting identity with a role and a trigger; every run is an owned session
// started through the core (`act("owned.start")`). Triggers are read once into a rule and then matched by code.
// Memory is a Markdown file in the agent's folder, pinned to its island.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionDefinition, CoreContext, DomainEvent, Entity, Source } from "../../core/types";
import { expandHome, isWithinPath, slugDe } from "../../core/util";
import { readTrigger } from "./reader";
import { describeRule, eventText, matches, nextDue, parseRule, type Rule } from "./rules";

type Row = {
  id: string; workspace_id: string; folder: string; name: string; role: string;
  trigger_text: string; rule: string | null; model: string | null; effort: string | null; memory_path: string;
  created_at: number; last_run_at: number | null;
  /** the run in progress (session id) and when it started; cleared by its session.done */
  run_session: string | null; run_started_at: number | null;
};

/** a run that never reported "done" stops blocking the next one after this long */
const RUN_TIMEOUT = 2 * 3600_000;

export function createAgentsSource(opts: { bin?: string; tickMs?: number } = {}): Source & { tick(now?: number): Promise<void> } {
  let ctx: CoreContext;
  let timer: ReturnType<typeof setInterval> | null = null;

  const rows = () => ctx.db.query(`SELECT * FROM agents_agents ORDER BY created_at`).all() as Row[];
  const row = (id: string) => ctx.db.query(`SELECT * FROM agents_agents WHERE id = ?`).get(id) as Row | null;
  const ruleOf = (r: Row): Rule | null => (r.rule ? parseRule(JSON.parse(r.rule)) : null);
  const running = (r: Row, now = Date.now()) => !!r.run_session && (r.run_started_at ?? 0) > now - RUN_TIMEOUT;

  /** Starts one run; skipped while the previous one is still working, so triggers never pile up. */
  async function startRun(r: Row, cause: string, now = Date.now()) {
    if (running(r, now)) {
      ctx.log("agents", "run.skipped", `agent:agents/${r.id}`, { cause, reason: "still running" });
      return { ok: false as const, status: 409, error: "The agent is already running." };
    }
    const text = [
      `You are the agent “${r.name}”. Your role: ${r.role}`,
      `Your memory is in ${r.memory_path}. Read it first. At the end, note there briefly what the next run needs to know.`,
      `Why this run started: ${cause}`,
    ].join("\n\n");
    const res = await ctx.act("owned.start", { cwd: r.folder, text, model: r.model ?? undefined, effort: r.effort ?? undefined, agent: r.id });
    if (!res.ok) {
      ctx.log("agents", "run.failed", `agent:agents/${r.id}`, { cause, error: res.error });
      return res;
    }
    const sessionId = (res.data as { id: string }).id;
    ctx.db.run(`UPDATE agents_agents SET last_run_at = ?, run_session = ?, run_started_at = ? WHERE id = ?`, [now, sessionId, now, r.id]);
    ctx.db.run(`INSERT INTO agents_runs (session_id, agent_id, cause, at) VALUES (?, ?, ?, ?)`, [sessionId, r.id, cause, now]);
    ctx.emit();
    return { ok: true as const, data: { sessionId } };
  }

  function onEvent(e: DomainEvent) {
    if (e.type === "session.done") {
      ctx.db.run(`UPDATE agents_agents SET run_session = NULL WHERE run_session = ?`, [e.sessionId]);
      // a run finishing never fires rules: an agent reacting to "session done" would otherwise restart itself forever
      if (ctx.db.query(`SELECT 1 FROM agents_runs WHERE session_id = ?`).get(e.sessionId)) return;
    }
    for (const r of rows()) {
      const rule = ruleOf(r);
      if (rule && matches(rule, e, { workspaceId: r.workspace_id, folder: r.folder })) void startRun(r, eventText(e));
    }
  }

  /** Schedules: a run is due when its next time after the last run (or creation) has passed — once, not per slot. */
  async function tick(now = Date.now()) {
    for (const r of rows()) {
      const rule = ruleOf(r);
      if (rule?.kind !== "schedule") continue;
      if (nextDue(rule.schedule, r.last_run_at ?? r.created_at) <= now) await startRun(r, describeRule(rule), now);
    }
  }

  /** Problem text when the folder is not inside the given workspace, else null. */
  function checkFolder(workspaceId: unknown, folder: unknown): string | null {
    const ws = ctx.workspaces.list().find((w) => w.id === workspaceId);
    if (!ws) return "Island missing.";
    const f = typeof folder === "string" && folder.trim() ? expandHome(folder) : ws.paths[0] && expandHome(ws.paths[0]);
    if (!f || !existsSync(f)) return "Folder not found.";
    return ws.paths.some((p) => isWithinPath(f, expandHome(p))) ? null : "The folder isn't in this island.";
  }

  /** Creates the memory file once (never overwrites) and pins it to the island. */
  async function ensureMemory(folder: string, name: string, role: string) {
    const dir = join(folder, ".orbit", "agents");
    const path = join(dir, `${slugDe(name)}.md`);
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, `# ${name}\n\n${role}\n\n## Memory\n\n(empty so far)\n`);
    }
    await ctx.act("files.pin", { path });
    return path;
  }

  type Input = { workspaceId?: string; folder?: string; name?: string; role?: string; trigger?: string; model?: string; effort?: string };

  const actions: ActionDefinition[] = [
    {
      id: "agents.create",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: Input) =>
        !i?.name?.trim() ? "Name missing." : !i.role?.trim() ? "Role missing." : rows().some((r) => slugDe(r.name) === slugDe(i.name as string)) ? "An agent with this name already exists." : checkFolder(i.workspaceId, i.folder),
      async run(i: Input) {
        const ws = ctx.workspaces.list().find((w) => w.id === i.workspaceId)!;
        const folder = expandHome(i.folder?.trim() || (ws.paths[0] as string));
        const name = (i.name as string).trim();
        const role = (i.role as string).trim();
        const trigger = i.trigger?.trim() ?? "";
        const read = await readTrigger(ctx.run, opts.bin ?? "claude", trigger, folder);
        const memory = await ensureMemory(folder, name, role);
        const id = crypto.randomUUID();
        // defaults (ADR-0017): agents use the balanced model with little thinking
        ctx.db.run(
          `INSERT INTO agents_agents (id, workspace_id, folder, name, role, trigger_text, rule, model, effort, memory_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, ws.id, folder, name, role, trigger, read.rule ? JSON.stringify(read.rule) : null, i.model ?? "sonnet", i.effort ?? "low", memory, Date.now()],
        );
        ctx.emit();
        return { ok: true, data: { id, ref: `agent:agents/${id}`, reading: describeRule(read.rule), error: read.error } };
      },
    },
    {
      // Role or trigger changed; a new trigger text is read again. Applies to the next run.
      id: "agents.update",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: Input & { id?: string }) => (typeof i?.id === "string" && row(i.id) ? null : "Agent not found."),
      async run(i: Input & { id: string }) {
        const r = row(i.id) as Row;
        const trigger = i.trigger === undefined ? r.trigger_text : i.trigger.trim();
        let rule = r.rule;
        let error: string | null = null;
        if (trigger !== r.trigger_text) {
          const read = await readTrigger(ctx.run, opts.bin ?? "claude", trigger, r.folder);
          rule = read.rule ? JSON.stringify(read.rule) : null;
          error = read.error;
        }
        ctx.db.run(`UPDATE agents_agents SET role = ?, trigger_text = ?, rule = ?, model = ?, effort = ? WHERE id = ?`, [
          i.role?.trim() || r.role, trigger, rule, i.model ?? r.model, i.effort ?? r.effort, r.id,
        ]);
        ctx.emit();
        return { ok: true, data: { reading: describeRule(rule ? parseRule(JSON.parse(rule)) : null), error } };
      },
    },
    {
      id: "agents.run", // "Run now"
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: string }) => (typeof i?.id === "string" && row(i.id) ? null : "Agent not found."),
      run: (i: { id: string }) => startRun(row(i.id) as Row, "Started by hand."),
    },
    {
      // Removes the definition; its memory file and past runs stay.
      id: "agents.delete",
      risk: "irreversible",
      allowedActors: ["board"],
      validate: (i: { id?: string }) => (typeof i?.id === "string" && row(i.id) ? null : "Agent not found."),
      run(i: { id: string }) {
        ctx.db.run(`DELETE FROM agents_agents WHERE id = ?`, [i.id]);
        ctx.emit();
        return { ok: true };
      },
    },
  ];

  function toEntity(r: Row): Entity {
    const rule = ruleOf(r);
    const runs = ctx.db.query(`SELECT session_id, cause, at FROM agents_runs WHERE agent_id = ? ORDER BY at DESC LIMIT 5`).all(r.id) as
      { session_id: string; cause: string; at: number }[];
    return {
      ref: `agent:agents/${r.id}`,
      kind: "agent",
      source: "agents",
      title: r.name,
      status: running(r) ? "running" : "idle",
      workspaceId: r.workspace_id,
      paths: [r.folder],
      keys: [`agent:${r.id}`],
      attention: null, // a run that needs the user lifts the agent through its related control entity
      parent: null,
      updatedAt: r.last_run_at ?? r.created_at,
      actions: ["agents.run", "agents.update", "agents.delete"],
      data: {
        id: r.id,
        role: r.role,
        trigger: r.trigger_text,
        reading: describeRule(rule),
        understood: !!rule,
        model: r.model,
        effort: r.effort,
        memoryPath: r.memory_path,
        lastRunAt: r.last_run_at,
        nextRunAt: rule?.kind === "schedule" ? nextDue(rule.schedule, r.last_run_at ?? r.created_at) : null,
        runs: runs.map((x) => ({ sessionId: x.session_id, cause: x.cause, at: x.at })),
      },
    };
  }

  return {
    id: "agents",
    migrations: [
      {
        version: 1,
        up: (db) =>
          db.exec(`
            CREATE TABLE agents_agents (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, folder TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
              trigger_text TEXT NOT NULL, rule TEXT, model TEXT, effort TEXT, memory_path TEXT NOT NULL,
              created_at INTEGER NOT NULL, last_run_at INTEGER, run_session TEXT, run_started_at INTEGER);
            CREATE TABLE agents_runs (session_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, cause TEXT NOT NULL, at INTEGER NOT NULL);`),
      },
    ],
    actions,
    routes: [],
    tick,
    start(c) {
      ctx = c;
      c.on((e) => {
        if (e.type === "element.archived" || e.type === "workspaces.changed") return;
        onEvent(e);
      });
      const every = opts.tickMs ?? 30_000;
      if (every > 0) timer = setInterval(() => void tick(), every);
    },
    entities: () => rows().map(toEntity),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
