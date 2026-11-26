// Contracts between the core, the sources and the board (ADR-0007, ADR-0008, ADR-0009).
// The board imports these types through JSDoc, so this file is the single API definition.
import type { Database } from "bun:sqlite";

// ---------- Workspaces ----------

export type Workspace = { id: string; name: string; paths: string[] };

// ---------- Entities (from sources, read-only for the canvas) ----------

/** Why an entity is listed under "Needs you". `level` picks the colour; `text` is shown as is. */
export type Attention = { level: "waiting" | "done" | "fail" | "ready" | "review"; text: string };

export type Entity = {
  /** Stable address `<kind>:<source>/<id>`, e.g. `session:claude/95af…`, `pr:github/acme/shop#7`. */
  ref: string;
  kind: string;
  source: string;
  title: string;
  /** Kind-specific status, rendered by the view (e.g. "working", "inactive", "open"). */
  status: string;
  /** Explicit workspace, or null to let the core assign one from `paths`. */
  workspaceId: string | null;
  /** Filesystem paths the core matches against workspace paths (longest match wins). */
  paths: string[];
  /** Shared keys link related entities across sources without them knowing each other. */
  keys: string[];
  attention: Attention | null;
  /** Entity this one is shown inside (e.g. a PR inside its repo panel); focus and layout follow it. */
  parent: string | null;
  updatedAt: number;
  /** Ids of actions this entity offers; the board shows only those. */
  actions: string[];
  /** Kind-specific payload for the views. */
  data: Record<string, unknown>;
};

/** Entity as sent to the board: workspace resolved, related refs computed by the core. */
export type ResolvedEntity = Entity & { workspaceId: string | null; related: string[] };

// ---------- Elements (canvas placement, owned by the core) ----------

export type Element = {
  id: string;
  ref: string;
  view: string | null; // null = the default view of the entity kind
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  z: number;
  parent: string | null;
  state: Record<string, unknown>;
  archived: boolean;
  updatedAt: number;
};

// ---------- Actions ----------

export type Actor = "board" | "agent" | "system";
export type Risk = "local" | "outward" | "irreversible";

export type ActionResult = { ok: true; data?: unknown } | { ok: false; status: number; error: string };

export type ActionDefinition<I = any> = {
  id: string; // "<source>.<verb>", e.g. "github.merge"
  risk: Risk;
  allowedActors: Actor[];
  /** Problem text, or null when the input is fine. */
  validate?(input: I): string | null;
  run(input: I): Promise<ActionResult> | ActionResult;
};

// ---------- Sources ----------

export type Migration = { version: number; up(db: Database): void };

export type Route = {
  method: "GET" | "POST";
  path: string; // exact path
  /** "board" needs the board token, "hook" the hook token; GETs are guarded by the host check. */
  auth: "board" | "hook" | "none";
  handle(req: Request): Response | Promise<Response>;
};

export type RunResult = { code: number; stdout: string; stderr: string };
export type Runner = (cmd: string[], cwd?: string) => Promise<RunResult>;

/** A long-running child process that talks in lines (ADR-0019): stdout arrives line by line, stdin takes lines. */
export type StreamProcess = {
  /** Write one line to stdin (the newline is added). Ignored once stdin is closed or the process ended. */
  write(line: string): void;
  /** Close stdin; a CLI in stream mode then finishes its turn and exits. */
  end(): void;
  kill(): void;
  /** Exit code; 127 when the command could not be started. */
  exited: Promise<number>;
};
export type SpawnOptions = {
  cwd?: string;
  /** Full environment of the child. Default: the server's own. */
  env?: Record<string, string | undefined>;
  onLine(line: string): void;
  onStderr?(text: string): void;
};
export type Spawner = (cmd: string[], opts: SpawnOptions) => StreamProcess;

/**
 * Domain events sources publish for each other (ADR-0020), e.g. to start agent runs. A closed list: a new type is
 * a deliberate change here plus the source that publishes it.
 */
export type DomainEvent =
  | { type: "pr.opened"; repo: string; number: number; branch: string; title: string; workspaceId: string | null }
  | { type: "pr.merged"; repo: string; number: number; branch: string; base: string | null; workspaceId: string | null }
  | { type: "ci.failed"; repo: string; number: number; branch: string; workspaceId: string | null }
  | { type: "session.done"; sessionId: string; cwd: string | null }
  | { type: "file.changed"; path: string };
export type DomainEventType = DomainEvent["type"];

export type CoreEvent =
  | { type: "element.archived"; ref: string }
  | { type: "workspaces.changed"; paths: string[] }
  | DomainEvent;

export type CoreContext = {
  db: Database;
  home: string;
  run: Runner;
  spawn: Spawner;
  workspaces: { list(): Workspace[] };
  canvas: { unarchive(ref: string): void };
  /** Append to the event log (`events` table). */
  log(source: string, type: string, ref: string | null, payload: unknown): void;
  /** Tell connected boards that state changed. Cheap; calls are coalesced. */
  emit(): void;
  on(listener: (e: CoreEvent) => void): void;
  /** Publish a domain event to every source (ADR-0020); it is written to the event log. */
  publish(event: DomainEvent): void;
  /**
   * Run an action of any source through the action layer as actor "system" (ADR-0020): validated, permission-checked
   * and logged. Only local actions that list "system" are allowed; nothing outward or irreversible.
   */
  act(id: string, input: unknown): Promise<ActionResult>;
};

export interface Source {
  id: string;
  migrations?: Migration[];
  start(ctx: CoreContext): void | Promise<void>;
  entities(): Entity[];
  actions?: ActionDefinition[];
  routes?: Route[];
  stop?(): void;
}

// ---------- API payloads ----------

export type StateResponse = {
  workspaces: Workspace[];
  entities: ResolvedEntity[];
  elements: Element[];
};

/** GET /api/claude/hooks (ADR-0031, ADR-0041): events the installed Orbit hook lacks, and whether any Orbit hook is installed. */
export type HookCheck = { missing: string[]; installed: boolean };

/** GET /api/claude/folders (ADR-0041): a folder Claude Code was used in that is no island yet. */
/** `recent`: sessions whose transcript changed in the last 7 days (ADR-0041, amendment) */
export type FolderSuggestion = { name: string; path: string; sessions: number; recent: number; lastUsed: number };

export type ActionRequest = { input?: unknown; confirm?: boolean };
