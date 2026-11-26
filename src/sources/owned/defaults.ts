// Run defaults per island (ADR-0025): model, thinking and mode, each set for the island or following Claude's settings.
// Claude's settings are read only, only three keys, on every call (edits apply at once); nothing is stored from them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionDefinition, CoreContext, Entity, Migration } from "../../core/types";
import { expandHome, isWithinPath } from "../../core/util";

export type RunValues = { model: string | null; effort: string | null; mode: string | null };
const NONE: RunValues = { model: null, effort: null, mode: null };

/** One settings file, or {} when missing or broken. */
function readSettings(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * What Claude Code would use in `dir`: local project settings, project settings, then the user's; first value wins.
 * A mode that bypasses permissions reads as the asking default: Orbit never runs a session that way (ADR-0019).
 */
export function claudeDefaults(dir: string, claudeHome: string): RunValues {
  const files = [join(dir, ".claude", "settings.local.json"), join(dir, ".claude", "settings.json"), join(claudeHome, "settings.json")].map(readSettings);
  const first = (f: (s: Record<string, any>) => unknown) => {
    for (const s of files) {
      const v = f(s);
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  const mode = first((s) => s.permissions?.defaultMode);
  return { model: first((s) => s.model), effort: first((s) => s.effortLevel), mode: mode === "bypassPermissions" ? "default" : mode };
}

type DefaultsRow = RunValues & { workspace_id: string };

export const defaultsMigration: Migration = {
  version: 5, // run defaults per island (ADR-0025)
  up: (db) => db.exec(`CREATE TABLE owned_island_defaults (workspace_id TEXT PRIMARY KEY, model TEXT, effort TEXT, mode TEXT)`),
};

export function createDefaults(ctx: () => CoreContext, claudeHome: string, check: (i: Partial<RunValues>) => string | null) {
  const set = (workspaceId: string): RunValues =>
    (ctx().db.query(`SELECT model, effort, mode FROM owned_island_defaults WHERE workspace_id = ?`).get(workspaceId) as RunValues | null) ?? NONE;

  /** The island a folder belongs to; the longest matching path wins, as in the core. */
  function islandOf(cwd: string) {
    let best: { id: string; len: number } | null = null;
    for (const w of ctx().workspaces.list())
      for (const raw of w.paths) {
        const p = expandHome(raw);
        if (isWithinPath(expandHome(cwd), p) && (!best || p.length > best.len)) best = { id: w.id, len: p.length };
      }
    return best?.id ?? null;
  }

  /** Values set for the island of `cwd` (passed to the CLI), and the effective defaults there (shown on the board). */
  function forFolder(cwd: string): { island: RunValues; effective: RunValues } {
    const id = islandOf(cwd);
    const island = id ? set(id) : NONE;
    const claude = claudeDefaults(expandHome(cwd), claudeHome);
    return { island, effective: { model: island.model ?? claude.model, effort: island.effort ?? claude.effort, mode: island.mode ?? claude.mode } };
  }

  /** One entity per island, so "New session" and the island menu can show and change its defaults. */
  const entities = (): Entity[] =>
    ctx().workspaces.list().map((w) => ({
      ref: `defaults:owned/${w.id}`,
      kind: "defaults",
      source: "owned",
      title: "",
      status: "",
      workspaceId: w.id,
      paths: [],
      keys: [],
      attention: null,
      parent: null,
      updatedAt: 0,
      actions: ["owned.setDefaults"],
      data: { set: set(w.id), claude: claudeDefaults(expandHome(w.paths[0] ?? "~"), claudeHome) },
    }));

  const action: ActionDefinition = {
    id: "owned.setDefaults",
    risk: "local",
    allowedActors: ["board"],
    validate: (i: { workspaceId?: unknown } & Partial<RunValues>) =>
      ctx().workspaces.list().some((w) => w.id === i?.workspaceId) ? check(i) : "Island not found.",
    run(i: { workspaceId: string } & Partial<RunValues>) {
      // a missing value means "follow Claude's settings"
      ctx().db.run(
        `INSERT INTO owned_island_defaults (workspace_id, model, effort, mode) VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET model = excluded.model, effort = excluded.effort, mode = excluded.mode`,
        [i.workspaceId, i.model ?? null, i.effort ?? null, i.mode ?? null],
      );
      ctx().emit();
      return { ok: true };
    },
  };

  return { forFolder, entities, action };
}
