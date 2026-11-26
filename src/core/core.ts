// The core (ADR-0007): database, event log, actions, canvas, workspaces, HTTP and SSE.
// It knows no source by name; sources plug in through the Source contract.
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { createActions } from "./actions";
import { canvasMigrations, createCanvas } from "./canvas";
import { migrate, openDatabase } from "./db";
import { createGuard, loadHookToken } from "./security";
import type {
  ActionRequest, CoreContext, CoreEvent, ResolvedEntity, Runner, Source, Spawner, StateResponse,
} from "./types";
import { json, problem } from "./util";
import { createWorkspaces } from "./workspaces";

const WEB_DIR = resolve(import.meta.dir, "..", "..", "web");

export type CoreOptions = {
  home: string;
  port: number;
  hostname?: string;
  run: Runner;
  spawn: Spawner;
  sources: Source[];
  boardToken?: string; // fixed token for tests
};

export async function createCore(opts: CoreOptions) {
  mkdirSync(opts.home, { recursive: true });
  const db = openDatabase(join(opts.home, "orbit.db"));
  migrate(db, "core", [
    {
      version: 1,
      up: (d) => d.exec(`CREATE TABLE event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, type TEXT NOT NULL,
        ref TEXT, payload TEXT, at INTEGER NOT NULL)`),
    },
  ]);
  migrate(db, "canvas", canvasMigrations);

  // ---------- Event bus and change notification ----------
  const listeners: ((e: CoreEvent) => void)[] = [];
  // one failing listener must not keep the event from the others
  const publish = (e: CoreEvent) =>
    listeners.forEach((l) => {
      try {
        l(e);
      } catch (err) {
        console.error(`Listener failed on ${e.type}:`, err);
      }
    });

  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const send = (chunk: string) => {
    for (const c of streams) {
      try {
        c.enqueue(encoder.encode(chunk));
      } catch {
        streams.delete(c);
      }
    }
  };
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => {
    emitTimer ??= setTimeout(() => {
      emitTimer = null;
      send(`event: change\ndata: ${Date.now()}\n\n`);
    }, 50);
  };
  const heartbeat = setInterval(() => send(`: keep-alive\n\n`), 25_000);

  const logStmt = db.prepare(`INSERT INTO event_log (source, type, ref, payload, at) VALUES (?, ?, ?, ?, ?)`);
  const log = (source: string, type: string, ref: string | null, payload: unknown) =>
    logStmt.run(source, type, ref, JSON.stringify(payload ?? null), Date.now());

  // ---------- Core services ----------
  const workspaces = createWorkspaces(
    opts.home,
    (paths) => {
      publish({ type: "workspaces.changed", paths });
      emit();
    },
    opts.run,
  );
  const canvas = createCanvas(db, publish);
  const actions = createActions((type, payload) => log("core", type, null, payload));
  actions.register(workspaces.actions);
  actions.register(canvas.actions);

  const ctx: CoreContext = {
    db,
    home: opts.home,
    run: opts.run,
    spawn: opts.spawn,
    workspaces: { list: workspaces.list },
    canvas: { unarchive: canvas.unarchive },
    log,
    emit,
    on: (l) => void listeners.push(l),
    publish(e) {
      log("core", `event.${e.type}`, null, e);
      publish(e);
    },
    act: (id, input) => actions.execute(id, input, "system"),
  };

  for (const s of opts.sources) {
    migrate(db, s.id, s.migrations ?? []);
    actions.register(s.actions);
  }
  for (const s of opts.sources) await s.start(ctx);

  // ---------- State ----------
  function state(): StateResponse {
    const ws = workspaces.list();
    const entities = opts.sources.flatMap((s) => s.entities());
    const byKey = new Map<string, string[]>();
    for (const e of entities) for (const k of e.keys) byKey.set(k, [...(byKey.get(k) ?? []), e.ref]);
    const resolved: ResolvedEntity[] = entities.map((e) => ({
      ...e,
      workspaceId: e.workspaceId ?? workspaces.match(e.paths, ws),
      related: [...new Set(e.keys.flatMap((k) => byKey.get(k) ?? []))].filter((r) => r !== e.ref),
    }));
    return { workspaces: ws, entities: resolved, elements: canvas.list() };
  }

  // ---------- HTTP ----------
  const guard = createGuard({ port: opts.port, hookToken: loadHookToken(opts.home), boardToken: opts.boardToken });
  const routes = opts.sources.flatMap((s) => s.routes ?? []);

  async function serveStatic(pathname: string) {
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = resolve(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + sep)) return new Response("Not found", { status: 404 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response("Not found", { status: 404 });
    // no-cache: the browser revalidates every module, so a changed file is never served stale from its cache
    // (without it, browsers guess a lifetime from Last-Modified and keep old board code for hours)
    if (rel !== "index.html") return new Response(f, { headers: { "Cache-Control": "no-cache" } });
    // The board receives its token with the page; other origins cannot read it.
    const html = (await f.text()).replace("</head>", `<meta name="orbit-token" content="${guard.boardToken}" />\n</head>`);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  function stream() {
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        streams.add(c);
        c.enqueue(encoder.encode(`event: change\ndata: ${Date.now()}\n\n`));
      },
      cancel() {
        streams.delete(ctrl);
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" },
    });
  }

  async function handle(req: Request): Promise<Response> {
    if (!guard.hostAllowed(req)) return problem(421, "Unbekannter Host.");
    const { pathname } = new URL(req.url);
    const mutating = req.method !== "GET" && req.method !== "HEAD";
    if (mutating && !guard.originAllowed(req)) return problem(403, "Fremde Herkunft.");

    if (req.method === "GET" && pathname === "/api/state") return json(state());
    if (req.method === "GET" && pathname === "/api/stream") return stream();

    const action = pathname.match(/^\/api\/actions\/([\w.-]+)$/);
    if (req.method === "POST" && action) {
      if (!guard.authorized(req, "board")) return problem(401, "Token missing or wrong.");
      const body = ((await req.json().catch(() => ({}))) ?? {}) as ActionRequest;
      const result = await actions.execute(action[1]!, body.input, "board", body.confirm === true);
      if (result.ok) emit();
      return result.ok ? json({ ok: true, data: result.data ?? null }) : problem(result.status, result.error);
    }

    const route = routes.find((r) => r.method === req.method && r.path === pathname);
    if (route) {
      if (!guard.authorized(req, route.auth)) return problem(401, "Token missing or wrong.");
      return route.handle(req);
    }

    if (req.method === "GET") return serveStatic(pathname);
    return problem(404, "Not found.");
  }

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname ?? "127.0.0.1",
    idleTimeout: 0, // SSE connections stay open
    fetch: (req) => handle(req).catch((err) => problem(500, String(err))),
  });

  return {
    server,
    db,
    state,
    execute: actions.execute,
    boardToken: guard.boardToken,
    stop() {
      clearInterval(heartbeat);
      if (emitTimer) clearTimeout(emitTimer);
      for (const s of opts.sources) s.stop?.();
      for (const c of streams) {
        try {
          c.close();
        } catch {}
      }
      server.stop(true);
      db.close();
    },
  };
}
