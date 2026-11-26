// Markdown files source (ADR-0011): pinned files as entities `file:fs/<absolute path>`, saved with conflict protection.
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { ActionDefinition, CoreContext, Entity, Route, Source } from "../../core/types";
import { json } from "../../core/util";
import { locateReference, openCommands } from "./open";
import { checkPath, listCandidates } from "./paths";
import { servePreview } from "./preview";

const MAX_BYTES = 256 * 1024;
export const fileRef = (path: string) => `file:fs/${path}`;
const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

type Snapshot = {
  path: string;
  exists: boolean;
  mtime: number;
  size: number;
  content: string | null; // null when missing or too large
  hash: string | null;
  tracked: boolean | null; // in git? null = not a repo or unknown
};

export function createFilesSource(opts: { pollMs?: number } = {}): Source & { poll(): Promise<void> } {
  let ctx: CoreContext;
  let timer: ReturnType<typeof setInterval> | null = null;
  const snapshots = new Map<string, Snapshot>(); // by path

  const pins = () => (ctx.db.query(`SELECT path FROM files_pins ORDER BY pinned_at`).all() as { path: string }[]).map((r) => r.path);

  async function isTracked(path: string): Promise<boolean | null> {
    const r = await ctx.run(["git", "-C", dirname(path), "ls-files", "--error-unmatch", "--", basename(path)]);
    if (r.code === 0) return true;
    return /not a git repository/i.test(r.stderr) ? null : false;
  }

  /** Re-reads a file when mtime or size changed. Returns true if anything changed. */
  async function readSnapshot(path: string): Promise<boolean> {
    const prev = snapshots.get(path);
    if (!existsSync(path)) {
      if (prev && !prev.exists) return false;
      snapshots.set(path, { path, exists: false, mtime: 0, size: 0, content: null, hash: null, tracked: prev?.tracked ?? null });
      return true;
    }
    const st = statSync(path);
    if (prev?.exists && prev.mtime === st.mtimeMs && prev.size === st.size) return false;
    const content = st.size <= MAX_BYTES ? readFileSync(path, "utf8") : null;
    const hash = content == null ? null : sha256(content);
    snapshots.set(path, { path, exists: true, mtime: st.mtimeMs, size: st.size, content, hash, tracked: await isTracked(path) });
    // a real content change of a file already known (not the first read, not a touch) is a domain event (ADR-0020)
    if (prev?.exists && prev.hash !== hash) ctx.publish({ type: "file.changed", path });
    return true;
  }

  async function poll() {
    let changed = false;
    for (const p of pins()) changed = (await readSnapshot(p)) || changed;
    if (changed) ctx.emit();
  }

  function toEntity(path: string): Entity {
    const s = snapshots.get(path);
    const check = checkPath(path, ctx.workspaces.list());
    const status = !s ? "loading" : !s.exists ? "missing" : s.content == null ? "too-large" : "ok";
    return {
      ref: fileRef(path),
      kind: "file",
      source: "files",
      title: basename(path),
      status,
      workspaceId: null,
      paths: [path],
      keys: [],
      attention: null,
      parent: null,
      updatedAt: s?.mtime ?? 0,
      actions: ["files.unpin", ...(status === "ok" ? ["files.save"] : [])],
      data: {
        path,
        rel: check.ok ? relative(check.root, check.path) : basename(path),
        content: s?.content ?? null,
        hash: s?.hash ?? null,
        size: s?.size ?? 0,
        tracked: s?.tracked ?? null,
      },
    };
  }

  const actions: ActionDefinition[] = [
    {
      id: "files.pin",
      risk: "local",
      allowedActors: ["board", "system"], // agents pin their memory file (ADR-0020)
      validate: (i: { path?: string }) => {
        const c = checkPath(i?.path ?? "", ctx.workspaces.list());
        return c.ok ? null : c.error;
      },
      async run(i: { path: string }) {
        const c = checkPath(i.path, ctx.workspaces.list());
        if (!c.ok) return { ok: false, status: 400, error: c.error };
        ctx.db.run(`INSERT INTO files_pins (path, pinned_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING`, [c.path, Date.now()]);
        await readSnapshot(c.path);
        return { ok: true, data: { ref: fileRef(c.path) } };
      },
    },
    {
      id: "files.unpin",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { path?: unknown }) => (typeof i?.path === "string" ? null : "Path missing."),
      run(i: { path: string }) {
        ctx.db.run(`DELETE FROM files_pins WHERE path = ?`, [i.path]);
        snapshots.delete(i.path);
        return { ok: true };
      },
    },
    {
      id: "files.save",
      risk: "local", // local file, protected by the hash check; tracked files remain recoverable through git
      allowedActors: ["board"],
      validate: (i: { path?: unknown; content?: unknown; baseHash?: unknown }) =>
        typeof i?.path === "string" && typeof i.content === "string" && typeof i.baseHash === "string" ? null : "Invalid input.",
      async run(i: { path: string; content: string; baseHash: string }) {
        const c = checkPath(i.path, ctx.workspaces.list());
        if (!c.ok) return { ok: false, status: 400, error: c.error };
        if (Buffer.byteLength(i.content) > MAX_BYTES) return { ok: false, status: 413, error: "The file is too large to edit." };
        const current = readFileSync(c.path, "utf8");
        if (sha256(current) !== i.baseHash) {
          await readSnapshot(c.path); // the board learns the current content and hash, so the user can choose
          return { ok: false, status: 409, error: "The file has changed since you opened it." };
        }
        // Atomic: agents and editors never see a half-written file.
        const tmp = join(dirname(c.path), `.${basename(c.path)}.orbit-${process.pid}-${Date.now()}.tmp`);
        try {
          writeFileSync(tmp, i.content);
          renameSync(tmp, c.path);
        } catch (err) {
          try {
            unlinkSync(tmp);
          } catch {}
          return { ok: false, status: 500, error: `Couldn't save: ${String(err)}` };
        }
        await readSnapshot(c.path);
        return { ok: true, data: { hash: snapshots.get(c.path)?.hash ?? null } };
      },
    },
    {
      id: "files.open",
      risk: "local", // shows a file in an app on the user's machine, changes nothing
      allowedActors: ["board"], // never agents: nothing opens on the user's screen unasked
      validate: (i: { path?: unknown; base?: unknown; line?: unknown; reveal?: unknown }) =>
        typeof i?.path === "string" && i.path && (i.base == null || typeof i.base === "string") && (i.line == null || Number.isInteger(i.line)) &&
        (i.reveal == null || typeof i.reveal === "boolean")
          ? null
          : "Invalid input.",
      async run(i: { path: string; base?: string | null; line?: number | null; reveal?: boolean }) {
        const c = locateReference(i.path, i.base, ctx.workspaces.list());
        if (!c.ok) return { ok: false, status: 400, error: c.error };
        // "Show in Finder" (ADR-0040): Finder with the file selected
        const cmds = i.reveal ? [["open", "-R", c.path]] : openCommands(c.path, { line: i.line, folder: statSync(c.path).isDirectory() });
        for (const cmd of cmds) {
          if ((await ctx.run(cmd)).code === 0) return { ok: true, data: { path: c.path, app: cmd[0] } };
        }
        return { ok: false, status: 500, error: "Couldn't open the file." };
      },
    },
  ];

  const routes: Route[] = [
    {
      method: "GET",
      path: "/api/files/candidates",
      auth: "none", // read-only; guarded by the host check like /api/state
      handle: () => json(listCandidates(ctx.workspaces.list())),
    },
    {
      method: "GET",
      path: "/api/files/raw", // the preview's bytes (ADR-0040)
      auth: "board", // reads any previewable file in a workspace, so only the board may ask
      handle: (req) => servePreview(new URL(req.url).searchParams, ctx.workspaces.list()),
    },
  ];

  return {
    id: "files",
    migrations: [
      { version: 1, up: (db) => db.exec(`CREATE TABLE files_pins (path TEXT PRIMARY KEY, pinned_at INTEGER NOT NULL)`) },
    ],
    actions,
    routes,
    poll,
    async start(c) {
      ctx = c;
      await poll();
      const every = opts.pollMs ?? 2000;
      if (every > 0) timer = setInterval(() => void poll(), every);
    },
    entities: () => pins().map(toEntity),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
