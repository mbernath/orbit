import type { Runner, Spawner } from "./types";

/** Runs an external command. Sources get it through the context so tests can stub it. */
export const defaultRunner: Runner = async (cmd, cwd) => {
  try {
    const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: "", stderr: String(err) };
  }
};

/** Starts a long-running process that talks in lines (ADR-0019). Sources get it through the context; tests stub it. */
export const defaultSpawner: Spawner = (cmd, opts) => {
  let p: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  try {
    p = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    opts.onStderr?.(String(err));
    return { write() {}, end() {}, kill() {}, exited: Promise.resolve(127) };
  }
  let open = true;
  const readLines = async () => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of chunks(p.stdout)) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) opts.onLine(line);
      }
    }
    if (buf.trim()) opts.onLine(buf);
  };
  const readErr = async () => {
    const dec = new TextDecoder();
    for await (const chunk of chunks(p.stderr)) opts.onStderr?.(dec.decode(chunk, { stream: true }));
  };
  // all output is delivered before `exited` resolves
  const exited = Promise.all([readLines(), readErr(), p.exited]).then(([, , code]) => ((open = false), code));
  return {
    write(line) {
      if (!open) return;
      try {
        p.stdin.write(line + "\n");
        p.stdin.flush();
      } catch {
        open = false;
      }
    },
    end() {
      if (!open) return;
      open = false;
      try {
        p.stdin.end();
      } catch {}
    },
    kill: () => p.kill(),
    exited,
  };
};

async function* chunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}
