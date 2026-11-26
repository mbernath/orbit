// Lists source (ADR-0036): a list node runs a command configured in Orbit inside its island's folder and shows the
// list the command prints. Read-only; the last good list stays when a run fails. Entities `list:lists/<id>`.
import { isAbsolute, join, relative } from "node:path";
import type { ActionDefinition, CoreContext, Entity, Route, Source } from "../../core/types";
import { expandHome, isWithinPath } from "../../core/util";
import { derive, LIST_VERSION, parseList, type ListDoc } from "./contract";

export const listRef = (id: string) => `list:lists/${id}`;
const TIMEOUT_MS = 30_000;
const INTERVALS = [0, 60, 300, 900, 3600]; // seconds; 0 = only on demand
const DEFAULT_INTERVAL = 300;
const GUIDE = join(import.meta.dir, "..", "..", "..", "docs", "list-contract.md");

type Row = {
  id: string;
  workspace_id: string;
  command: string;
  title: string | null;
  interval_s: number;
  created_at: number;
  list: string | null; // last good list (JSON)
  fetched_at: number | null;
  error: string | null; // last failure, cleared by a good run
  error_at: number | null;
};
type RunOutcome = { ok: true; list: ListDoc } | { ok: false; error: string };

export function createListsSource(opts: { tickMs?: number } = {}): Source & { tick(now?: number): Promise<void> } {
  let ctx: CoreContext;
  let timer: ReturnType<typeof setInterval> | null = null;
  const running = new Set<string>();

  const rows = () => ctx.db.query(`SELECT * FROM lists_nodes ORDER BY created_at`).all() as Row[];
  const row = (id: string) => ctx.db.query(`SELECT * FROM lists_nodes WHERE id = ?`).get(id) as Row | null;
  const folderOf = (workspaceId: string) => {
    const p = ctx.workspaces.list().find((w) => w.id === workspaceId)?.paths[0];
    return p ? expandHome(p) : null;
  };

  /** One run of the command in the island's folder: through the shell, so pipes and arguments work. */
  async function runCommand(workspaceId: string, command: string): Promise<RunOutcome> {
    const cwd = folderOf(workspaceId);
    if (!cwd) return { ok: false, error: "The island has no folder." };
    const cmd = ["/usr/bin/env", `ORBIT_LIST_VERSION=${LIST_VERSION}`, "/bin/sh", "-c", command];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      ctx.run(cmd, cwd),
      new Promise<null>((res) => (timeout = setTimeout(() => res(null), TIMEOUT_MS))),
    ]);
    clearTimeout(timeout);
    if (!r) return { ok: false, error: `The script didn't answer within ${TIMEOUT_MS / 1000} s.` };
    if (r.code === 127 && !r.stdout.trim()) return { ok: false, error: "Command not found." };
    const p = parseList(r.stdout, r.code);
    return p.ok ? { ok: true, list: p.list } : p;
  }

  async function refresh(id: string) {
    const r = row(id);
    if (!r || running.has(id)) return;
    running.add(id);
    ctx.emit();
    try {
      const out = await runCommand(r.workspace_id, r.command);
      const now = Date.now();
      if (out.ok) ctx.db.run(`UPDATE lists_nodes SET list = ?, fetched_at = ?, error = NULL, error_at = NULL WHERE id = ?`, [JSON.stringify(out.list), now, id]);
      else ctx.db.run(`UPDATE lists_nodes SET error = ?, error_at = ? WHERE id = ?`, [out.error, now, id]);
    } finally {
      running.delete(id);
      ctx.emit();
    }
  }

  /** refreshes every node whose interval has passed since its last run, good or failed */
  async function tick(now = Date.now()) {
    const due = rows().filter((r) => r.interval_s > 0 && now - Math.max(r.fetched_at ?? 0, r.error_at ?? 0) >= r.interval_s * 1000);
    await Promise.all(due.map((r) => refresh(r.id)));
  }

  function toEntity(r: Row): Entity {
    const list = r.list ? (JSON.parse(r.list) as ListDoc) : null;
    const status = running.has(r.id) && !list ? "loading" : !list ? (r.error ? "error" : "loading") : r.error ? "stale" : "ok";
    return {
      ref: listRef(r.id),
      kind: "list",
      source: "lists",
      title: r.title ?? list?.title ?? "List",
      status,
      workspaceId: r.workspace_id,
      paths: [],
      keys: [],
      attention: null,
      parent: null,
      updatedAt: Math.max(r.fetched_at ?? 0, r.error_at ?? 0, r.created_at),
      actions: ["lists.refresh", "lists.update", "lists.remove"],
      data: {
        id: r.id,
        command: r.command,
        title: r.title,
        interval: r.interval_s,
        list,
        derived: list ? derive(list) : null,
        fetchedAt: r.fetched_at,
        error: r.error,
        errorAt: r.error_at,
        running: running.has(r.id),
      },
    };
  }

  const checkConfig = (i: { workspaceId?: unknown; command?: unknown; interval?: unknown }) =>
    typeof i?.workspaceId !== "string" || !ctx.workspaces.list().some((w) => w.id === i.workspaceId)
      ? "Island not found."
      : typeof i.command !== "string" || !i.command.trim()
        ? "Command missing."
        : i.interval != null && !INTERVALS.includes(Number(i.interval))
          ? "Invalid interval."
          : null;
  const known = (i: { id?: unknown }) => (typeof i?.id === "string" && row(i.id) ? null : "List not found.");
  const preview = (list: ListDoc) => ({ title: list.title, ...derive(list) });

  const actions: ActionDefinition[] = [
    {
      // a trial run for the dialog: nothing is stored
      id: "lists.test",
      risk: "local",
      allowedActors: ["board"],
      validate: checkConfig,
      async run(i: { workspaceId: string; command: string }) {
        const out = await runCommand(i.workspaceId, i.command.trim());
        return out.ok ? { ok: true, data: preview(out.list) } : { ok: false, status: 422, error: out.error };
      },
    },
    {
      // pins only after a good run, so a node never starts out broken
      id: "lists.add",
      risk: "local",
      allowedActors: ["board"],
      validate: checkConfig,
      async run(i: { workspaceId: string; command: string; title?: string; interval?: number | string }) {
        const command = i.command.trim();
        const out = await runCommand(i.workspaceId, command);
        if (!out.ok) return { ok: false, status: 422, error: out.error };
        const id = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        ctx.db.run(
          `INSERT INTO lists_nodes (id, workspace_id, command, title, interval_s, created_at, list, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, i.workspaceId, command, i.title?.trim() || null, i.interval == null ? DEFAULT_INTERVAL : Number(i.interval), now, JSON.stringify(out.list), now],
        );
        return { ok: true, data: { ref: listRef(id), id } };
      },
    },
    {
      id: "lists.refresh",
      risk: "local",
      allowedActors: ["board"],
      validate: known,
      async run(i: { id: string }) {
        await refresh(i.id);
        const r = row(i.id);
        return r?.error ? { ok: false, status: 422, error: r.error } : { ok: true };
      },
    },
    {
      id: "lists.update",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: unknown; command?: unknown; interval?: unknown }) =>
        known(i) ??
        (i.command != null && (typeof i.command !== "string" || !i.command.trim()) ? "Command missing." : null) ??
        (i.interval != null && !INTERVALS.includes(Number(i.interval)) ? "Invalid interval." : null),
      async run(i: { id: string; command?: string; title?: string | null; interval?: number | string }) {
        const r = row(i.id) as Row;
        const command = i.command?.trim() ?? r.command;
        const title = i.title === undefined ? r.title : i.title?.trim() || null;
        const interval = i.interval == null ? r.interval_s : Number(i.interval);
        ctx.db.run(`UPDATE lists_nodes SET command = ?, title = ?, interval_s = ? WHERE id = ?`, [command, title, interval, i.id]);
        if (command !== r.command) await refresh(i.id);
        return { ok: true };
      },
    },
    {
      id: "lists.remove",
      risk: "local", // only Orbit's configuration; the script stays untouched
      allowedActors: ["board"],
      validate: known,
      run(i: { id: string }) {
        ctx.db.run(`DELETE FROM lists_nodes WHERE id = ?`, [i.id]);
        return { ok: true };
      },
    },
    {
      // native macOS file dialog, like the folder picker (ADR-0035); a path inside the island comes back relative
      id: "lists.pickScript",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { workspaceId?: unknown }) => (typeof i?.workspaceId === "string" && folderOf(i.workspaceId) ? null : "Island not found."),
      async run(i: { workspaceId: string }) {
        const folder = folderOf(i.workspaceId) as string;
        const script = `POSIX path of (choose file with prompt "Script for the list" default location POSIX file ${JSON.stringify(folder)})`;
        const r = await ctx.run(["osascript", "-e", script]);
        if (r.code !== 0) {
          if (/-128/.test(r.stderr)) return { ok: true, data: { command: null } };
          return { ok: false, status: 500, error: "Couldn't open the file dialog. Enter the command by hand." };
        }
        const path = r.stdout.trim();
        const rel = isWithinPath(path, folder) ? relative(folder, path) : path;
        const command = isAbsolute(rel) ? shellQuote(rel) : shellQuote(`./${rel}`);
        return { ok: true, data: { command } };
      },
    },
  ];

  const routes: Route[] = [
    {
      // the guide for script authors, copied by the board into another session (docs/list-contract.md)
      method: "GET",
      path: "/api/lists/guide",
      auth: "none", // read-only, guarded by the host check like /api/state
      handle: () => new Response(Bun.file(GUIDE), { headers: { "Content-Type": "text/markdown; charset=utf-8" } }),
    },
  ];

  return {
    id: "lists",
    routes,
    migrations: [
      {
        version: 1,
        up: (db) =>
          db.exec(`CREATE TABLE lists_nodes (
            id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, command TEXT NOT NULL, title TEXT, interval_s INTEGER NOT NULL,
            created_at INTEGER NOT NULL, list TEXT, fetched_at INTEGER, error TEXT, error_at INTEGER)`),
      },
    ],
    actions,
    tick,
    start(c) {
      ctx = c;
      void tick(); // a restart shows the stored list at once and refreshes what is due
      const every = opts.tickMs ?? 30_000;
      if (every > 0) timer = setInterval(() => void tick(), every);
    },
    entities: () => rows().map(toEntity),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

/** quotes a path for /bin/sh only when it needs it */
const shellQuote = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
