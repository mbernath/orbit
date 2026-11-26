// Workspace registry backed by workspaces.json. Read on every access, so manual edits apply at once.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionDefinition, Runner, Workspace } from "./types";
import { expandHome, isWithinPath, slug } from "./util";

export function createWorkspaces(home: string, onChange: (paths: string[]) => void, run: Runner) {
  const file = join(home, "workspaces.json");

  const list = (): Workspace[] => {
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };
  const save = (items: Workspace[]) => writeFileSync(file, JSON.stringify(items, null, 2) + "\n");

  /** Longest matching workspace path wins, so nested workspaces work. */
  function match(paths: string[], items = list()): string | null {
    let best: { id: string; len: number } | null = null;
    for (const ws of items) {
      for (const raw of ws.paths) {
        const p = expandHome(raw);
        if (paths.some((c) => isWithinPath(c, p)) && (!best || p.length > best.len)) best = { id: ws.id, len: p.length };
      }
    }
    return best?.id ?? null;
  }

  const actions: ActionDefinition[] = [
    {
      id: "workspaces.add",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { name?: string; path?: string }) => (i?.name?.trim() && i?.path?.trim() ? null : "Name and path are required."),
      run(i: { name: string; path: string }) {
        const items = list();
        let id = slug(i.name);
        for (let n = 2; items.some((w) => w.id === id); n++) id = `${slug(i.name)}-${n}`;
        items.push({ id, name: i.name.trim(), paths: [i.path.trim()] });
        save(items);
        onChange([i.path.trim()]);
        return { ok: true, data: { id } };
      },
    },
    {
      // The native macOS folder dialog (ADR-0035): a browser cannot hand out a local path. Cancel is no error.
      id: "workspaces.pickFolder",
      risk: "local",
      allowedActors: ["board"],
      async run() {
        const r = await run(["osascript", "-e", 'POSIX path of (choose folder with prompt "Folder for the new island")']);
        if (r.code === 0) return { ok: true, data: { path: r.stdout.trim().replace(/(.)\/$/, "$1") } };
        if (/-128/.test(r.stderr)) return { ok: true, data: { path: null } };
        return { ok: false, status: 500, error: "Couldn't open the folder dialog. Enter the path by hand." };
      },
    },
    {
      // Renaming changes only the display name; the id (and with it the island's frame) stays.
      id: "workspaces.rename",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: string; name?: string }) =>
        !i?.id ? "Island missing." : !i.name?.trim() ? "Name missing." : list().some((w) => w.id === i.id) ? null : "Island not found.",
      run(i: { id: string; name: string }) {
        save(list().map((w) => (w.id === i.id ? { ...w, name: i.name.trim() } : w)));
        onChange([]);
        return { ok: true };
      },
    },
    {
      id: "workspaces.remove",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { id?: string }) => (i?.id ? null : "Island missing."),
      run(i: { id: string }) {
        save(list().filter((w) => w.id !== i.id));
        onChange([]);
        return { ok: true };
      },
    },
  ];

  return { list, match, actions };
}
