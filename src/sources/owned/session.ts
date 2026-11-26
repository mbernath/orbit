// One owned session: at most one `claude -p` process, messages queued while a turn runs (ADR-0019).
// The process stays open between turns; if it ended, the next message resumes the session by its id.
import type { Spawner, StreamProcess } from "../../core/types";
import type { Image } from "./attachments";
import { applyLine, initialRun, permissionLine, type RunState, userLine } from "./stream";
import { TITLE_PROMPT } from "../../core/util";

/** mode: the CLI's permission mode; null = its default, which asks for everything that needs a permission */
export type SessionSpec = { id: string; cwd: string; model: string | null; effort: string | null; mode?: string | null };

export type OwnedSession = {
  readonly state: RunState;
  readonly queued: number;
  readonly running: boolean;
  send(text: string, images?: Image[]): void;
  answer(allow: boolean, message?: string, answers?: Record<string, string>): boolean;
  stop(): Promise<void>;
};

/** Environment for the child: the user's own login, never an API key from the server's environment (ADR-0019). */
export function childEnv(base: Record<string, string | undefined>) {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function claudeArgs(bin: string, spec: SessionSpec, resume: boolean): string[] {
  return [
    bin, "-p",
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--permission-prompt-tool", "stdio", // permission requests come to Orbit instead of being denied silently
    // a new session names itself in its first reply (ADR-0032); a resumed one already has its title
    ...(resume ? ["--resume", spec.id] : ["--session-id", spec.id, "--append-system-prompt", TITLE_PROMPT]),
    ...(spec.model ? ["--model", spec.model] : []),
    ...(spec.effort ? ["--effort", spec.effort] : []),
    ...(spec.mode ? ["--permission-mode", spec.mode] : []),
  ];
}

/**
 * @param resume whether the session already exists (taken over, or started before) — then the process resumes it
 * @param onChange called on every state change, and when the process ended (with its exit code)
 */
export function createOwnedSession(
  spec: SessionSpec,
  opts: { spawn: Spawner; bin: string; env: Record<string, string | undefined>; resume: boolean; onChange(exitCode?: number): void },
): OwnedSession {
  let state = initialRun();
  let proc: StreamProcess | null = null;
  let busy = false;
  let started = opts.resume;
  const queue: { text: string; images: Image[] }[] = [];
  let stderr = "";

  const set = (s: RunState) => {
    state = s;
    opts.onChange();
  };

  function ensureProcess(): StreamProcess {
    if (proc) return proc;
    stderr = "";
    const p = opts.spawn(claudeArgs(opts.bin, spec, started), {
      cwd: spec.cwd,
      env: opts.env,
      onLine(line) {
        const ev = applyLine(state, line);
        if (ev.kind === "turn-end") {
          busy = false;
          set(ev.state);
          next();
        } else set(ev.state);
      },
      onStderr: (t) => (stderr = (stderr + t).slice(-2000)),
    });
    started = true; // from now on the CLI knows this id; a new process must resume
    proc = p;
    p.exited.then((code) => {
      if (proc !== p) return;
      proc = null;
      const broke = busy || code !== 0;
      busy = false;
      state = {
        ...state,
        status: "idle",
        permission: null,
        error: broke && code !== 0 ? `Claude Code exited (code ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}` : state.error,
      };
      opts.onChange(code);
      next(); // messages that arrived while it was ending start a new, resuming process
    });
    return p;
  }

  function next() {
    if (busy || !queue.length) return;
    busy = true;
    const m = queue.shift() as { text: string; images: Image[] };
    state = { ...state, status: "working", error: null };
    ensureProcess().write(userLine(m.text, m.images));
    opts.onChange();
  }

  return {
    get state() {
      return state;
    },
    get queued() {
      return queue.length;
    },
    get running() {
      return !!proc;
    },
    send(text, images = []) {
      queue.push({ text, images });
      next();
    },
    answer(allow, message, answers) {
      const p = state.permission;
      if (!p || !proc) return false;
      proc.write(permissionLine(p, allow, message, answers));
      set({ ...state, status: "working", permission: null });
      return true;
    },
    async stop() {
      queue.length = 0;
      const p = proc;
      if (!p) return;
      p.end();
      const t = setTimeout(() => p.kill(), 5000);
      await p.exited;
      clearTimeout(t);
    },
  };
}
