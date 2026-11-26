// Opening a file Claude refers to (ADR-0030): resolve the reference, then pick the app. The action runs the commands.
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Workspace } from "../../core/types";
import { type Checked, checkAnyPath } from "./paths";

/** Shown better by the default app (browser, Preview) than in an editor. */
const VIEWER = /\.(html?|pdf|png|jpe?g|gif|webp|svg|heic)$/i;

/** Absolute path for a reference as written in text: file:// URL, absolute, ~/…, or relative to `base`. Null if it cannot be resolved. */
export function resolveReference(ref: string, base?: string | null, home = homedir()): string | null {
  let p = ref.trim();
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      return null;
    }
  } else {
    try {
      p = decodeURIComponent(p);
    } catch {}
  }
  if (!p) return null;
  if (p === "~" || p.startsWith("~/")) return resolve(home, p.slice(2));
  if (isAbsolute(p)) return resolve(p);
  return base && isAbsolute(base) ? resolve(base, p) : null;
}

/**
 * Where a reference may point, best guess first. A relative path is tried against `base` and then against each
 * parent of `base`: Claude writes paths relative to the repo root even after a `cd` into a subfolder.
 */
export function referenceCandidates(ref: string, base?: string | null, home = homedir()): string[] {
  const first = resolveReference(ref, base, home);
  if (!first || !base || !isAbsolute(base) || resolveReference(ref, null, home)) return first ? [first] : [];
  const out = [first];
  for (let dir = resolve(base); dirname(dir) !== dir; ) {
    dir = dirname(dir);
    out.push(resolveReference(ref, dir, home)!);
  }
  return out;
}

/** The real path a reference names, within the ADR-0030 limits: the first candidate that exists and may be shown, else why the best guess may not. */
export function locateReference(ref: string, base: string | null | undefined, workspaces: Workspace[]): Checked {
  const tries = referenceCandidates(ref, base);
  if (!tries.length) return { ok: false, error: "Relative path without a folder to resolve it from." };
  return tries.map((p) => checkAnyPath(p, workspaces)).find((r) => r.ok) ?? checkAnyPath(tries[0]!, workspaces);
}

/** The command that shows the file: viewer files and folders with `open`, everything else in VS Code at the line. */
export function openCommands(path: string, opts: { line?: number | null; folder?: boolean }): string[][] {
  const open = ["open", path];
  if (opts.folder || VIEWER.test(path)) return [open];
  const at = opts.line && opts.line > 0 ? `${path}:${opts.line}` : path;
  return [["code", "-g", at], open]; // `open` only if VS Code's CLI is missing
}
