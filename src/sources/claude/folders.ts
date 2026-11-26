// The folders Claude Code was used in, read from the projects dir (read only), as island suggestions for the empty
// board (ADR-0041). One project dir per folder: its transcripts count the sessions, the newest mtime is the last use,
// and the first line carrying `cwd` names the folder (the dir name's encoding is lossy).
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { FolderSuggestion } from "../../core/types";
import { isWithin } from "./transcripts";

export type ProjectFolder = { path: string; sessions: number; recent: number; lastUsed: number };

/** "this week" of the suggestions and the first island: the last 7 days */
export const RECENT_MS = 7 * 86_400_000;

/** the first `cwd` in the first 64 KB of a transcript */
function cwdOf(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(65_536);
    const text = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = JSON.parse(line).cwd;
        if (typeof cwd === "string" && cwd) return cwd;
      } catch {} // the last line may be cut
    }
  } catch {
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

/** cwd per project dir: a folder never moves, so it is read once per process */
const cwdCache = new Map<string, string | null>();

/** Every folder that still exists, with its sessions and last use, most recent first. */
export function readProjectFolders(projectsDir: string, now = Date.now()): ProjectFolder[] {
  if (!existsSync(projectsDir)) return [];
  const byPath = new Map<string, ProjectFolder>();
  for (const dir of readdirSync(projectsDir)) {
    const full = join(projectsDir, dir);
    let files: string[];
    try {
      files = readdirSync(full).filter((f) => f.endsWith(".jsonl")).map((f) => join(full, f));
    } catch {
      continue;
    }
    let lastUsed = 0, newest = "", recent = 0;
    for (const f of files) {
      try {
        const m = statSync(f).mtimeMs;
        if (m >= now - RECENT_MS) recent++;
        if (m > lastUsed) (lastUsed = m), (newest = f);
      } catch {}
    }
    if (!newest) continue;
    if (!cwdCache.has(full) || !cwdCache.get(full)) cwdCache.set(full, cwdOf(newest));
    const path = cwdCache.get(full);
    if (!path || !existsSync(path)) continue;
    const seen = byPath.get(path);
    if (seen) (seen.sessions += files.length), (seen.recent += recent), (seen.lastUsed = Math.max(seen.lastUsed, lastUsed));
    else byPath.set(path, { path, sessions: files.length, recent, lastUsed });
  }
  return [...byPath.values()].sort((a, b) => b.lastUsed - a.lastUsed);
}

/** The top five folders not yet inside an island. */
export function suggestFolders(folders: ProjectFolder[], islandPaths: string[], limit = 5): FolderSuggestion[] {
  return folders
    .filter((f) => !isWithin(f.path, islandPaths))
    .slice(0, limit)
    .map((f) => ({ name: basename(f.path), ...f }));
}
