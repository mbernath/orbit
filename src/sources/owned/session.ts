// One owned session: at most one `claude -p` process, messages queued while a turn runs (ADR-0019).
// The process stays open between turns; if it ended, the next message resumes the session by its id.
import type { Spawner, StreamProcess } from "../../core/types";
import type { Image } from "./attachments";
import { applyLine, initialRun, interruptLine, permissionLine, type RunState, userLine } from "./stream";
import { TITLE_PROMPT } from "../../core/util";

/** mode: the CLI's permission mode; null = its default, which asks for everything that needs a permission */
export type SessionSpec = { id: string; cwd: string; model: string | null; effort: string | null; mode?: string | null };

export type OwnedSession = {
  readonly state: RunState;
  readonly queued: number;
  readonly running: boolean;
  /** when the running turn began (ms), null between turns */
  readonly since: number | null;
  send(text: string, images?: Image[]): void;
  answer(allow: boolean, message?: string, answers?: Record<string, string>): boolean;
  /**
   * Stops the running turn and drops the queue (ADR-0044): the CLI is asked to interrupt; if it has not ended the
   * turn after `graceMs`, the process ends and the next message resumes. Returns the dropped messages' texts.
   */
  interrupt(graceMs?: number): Promise<string[]>;
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
  let since: number | null = null;
  /** set while an interrupt waits for the turn to end; called when it did */
  let stopping: (() => void) | null = null;
  let requests = 0;

  /** the turn is over: a stop the user asked for is not an error */
  function ended(s: RunState): RunState {
    since = null;
    if (!stopping) return s;
    const done = stopping;
    stopping = null;
    done();
    return { ...s, error: null, activity: null };
  }

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
          set(ended(ev.state));
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
      const asked = !!stopping; // the user stopped it: ending is what they wanted
      const broke = busy || code !== 0;
      busy = false;
      state = {
        ...ended(state),
        activity: null,
        status: "idle",
        permission: null,
        error: asked ? null : broke && code !== 0 ? `Claude Code exited (code ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}` : state.error,
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
    since = Date.now();
    state = { ...state, status: "working", error: null, activity: null };
    ensureProcess().write(userLine(m.text, m.images));
    opts.onChange();
  }

  /** ends the process: stdin closed, killed if it does not exit within 5 s */
  async function endProcess() {
    const p = proc;
    if (!p) return;
    p.end();
    const t = setTimeout(() => p.kill(), 5000);
    await p.exited;
    clearTimeout(t);
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
    get since() {
      return since;
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
    async interrupt(graceMs = 3000) {
      const dropped = queue.splice(0).map((m) => m.text);
      const p = proc;
      if (!busy || !p) return opts.onChange(), dropped;
      const over = new Promise<void>((r) => (stopping = r));
      p.write(interruptLine(`orbit-interrupt-${++requests}`));
      set({ ...state, activity: "Stopping" });
      // the CLI did not end the turn in time: end the process; the next message resumes the session
      const t = setTimeout(() => void endProcess(), graceMs);
      await over;
      clearTimeout(t);
      return dropped;
    },
    stop() {
      queue.length = 0;
      return endProcess();
    },
  };
}
