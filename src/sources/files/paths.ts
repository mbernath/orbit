// Which Markdown files Orbit may read and write (ADR-0009, ADR-0011).
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import type { Workspace } from "../../core/types";
import { expandHome, isWithinPath } from "../../core/util";

const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target", "coverage"]);
const MAX_CANDIDATES = 2000;
const MAX_DEPTH = 6;

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** Real workspace roots; missing folders are left out. */
export const workspaceRoots = (workspaces: Workspace[]) =>
  workspaces.flatMap((w) => w.paths.map((p) => ({ workspaceId: w.id, root: real(expandHome(p)) }))).filter(
    (r): r is { workspaceId: string; root: string } => !!r.root,
  );

/**
 * Resolves `path` to a real path Orbit may touch, or explains why not.
 * Symlinks are resolved first, so a link inside a workspace cannot point outside it.
 */
export function checkPath(path: string, workspaces: Workspace[]): Checked {
  if (typeof path !== "string" || !path) return { ok: false, error: "Path missing." };
  if (!/\.md$/i.test(path)) return { ok: false, error: "Only Markdown files (.md) are allowed." };
  const c = checkAnyPath(path, workspaces);
  if (c.ok && !/\.md$/i.test(c.path)) return { ok: false, error: "Only Markdown files (.md) are allowed." };
  return c;
}

export type Checked = { ok: true; path: string; root: string; workspaceId: string } | { ok: false; error: string };

/** The location limits alone, for any file type or folder: only for reading or showing, never for writing (ADR-0030). */
export function checkAnyPath(path: string, workspaces: Workspace[]): Checked {
  if (typeof path !== "string" || !path) return { ok: false, error: "Path missing." };
  const p = real(path);
  if (!p) return { ok: false, error: "File not found." };
  if (p.split(sep).includes(".git")) return { ok: false, error: "Files in .git are off limits." };
  const claudeDir = real(join(homedir(), ".claude"));
  if (claudeDir && isWithinPath(p, claudeDir)) return { ok: false, error: "Claude Code's own files are off limits." };
  // Longest matching root wins, like the workspace assignment.
  const match = workspaceRoots(workspaces)
    .filter((r) => isWithinPath(p, r.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (!match) return { ok: false, error: "The file isn't in any island." };
  return { ok: true, path: p, root: match.root, workspaceId: match.workspaceId };
}

export type Candidate = { workspaceId: string; path: string; rel: string };

/** All Markdown files below the workspace roots, for the picker. Hidden and build folders are skipped. */
export function listCandidates(workspaces: Workspace[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const { workspaceId, root } of workspaceRoots(workspaces)) {
    const walk = (dir: string, depth: number) => {
      if (out.length >= MAX_CANDIDATES || depth > MAX_DEPTH) return;
      let entries: import("node:fs").Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name) && !seen.has(full)) {
          seen.add(full);
          out.push({ workspaceId, path: full, rel: relative(root, full) || basename(full) });
        }
      }
    };
    if (existsSync(root)) walk(root, 0);
  }
  return out.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.rel.localeCompare(b.rel));
}
