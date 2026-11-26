// Which Claude Code hook events Orbit needs, and whether ~/.claude/settings.json still has all of them (ADR-0031).
// One list for the installer and the check, so a new event cannot be added to one and forgotten in the other.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookCheck } from "../../core/types";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "Notification", "Stop", "SessionEnd"];

export const isOrbitHook = (h: { command?: string }) => !!h?.command?.includes("orbit-hook.sh");

type Settings = { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };

/**
 * Events the Orbit hook is missing for. Empty when it is installed for all of them — and also when it is installed
 * for none: then Orbit simply runs without hooks, which is a choice, not a stale install.
 */
export function missingHooks(settings: Settings | null): string[] {
  const has = (event: string) => (settings?.hooks?.[event] ?? []).some((g) => (g?.hooks ?? []).some(isOrbitHook));
  const missing = HOOK_EVENTS.filter((e) => !has(e));
  return missing.length === HOOK_EVENTS.length ? [] : missing;
}

/** Whether any Orbit hook is installed, current or stale (ADR-0041). */
export const isInstalled = (settings: Settings | null) =>
  Object.values(settings?.hooks ?? {}).some((groups) => (groups ?? []).some((g) => (g?.hooks ?? []).some(isOrbitHook)));

/** Reads Claude Code's global settings; read only, a missing or broken file counts as no settings. */
export function readHookCheck(claudeHome: string): HookCheck {
  let settings: Settings | null = null;
  try {
    settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
  } catch {}
  return { missing: missingHooks(settings), installed: isInstalled(settings) };
}
