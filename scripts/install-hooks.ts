// Adds the Orbit hook globally to ~/.claude/settings.json (or removes it with --uninstall).
// Writes a backup first and leaves all other settings and hooks untouched.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HOOK_EVENTS as EVENTS, isOrbitHook as isOrbit } from "../src/sources/claude/hook-setup";

const settingsPath = process.env.CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");
const hookScript = resolve(import.meta.dir, "..", "hooks", "orbit-hook.sh");
const uninstall = process.argv.includes("--uninstall");

chmodSync(hookScript, 0o755);
mkdirSync(dirname(settingsPath), { recursive: true });

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
if (existsSync(settingsPath)) {
  const backup = `${settingsPath}.orbit-backup-${Date.now()}`;
  copyFileSync(settingsPath, backup);
  console.log(`Backup: ${backup}`);
}

settings.hooks ??= {};

for (const event of EVENTS) {
  const groups: { matcher?: string; hooks: { type: string; command?: string }[] }[] =
    settings.hooks[event] ?? [];
  // Remove old Orbit entries first, so running this twice adds nothing twice.
  for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => !isOrbit(h));
  const cleaned = groups.filter((g) => g.hooks.length > 0);
  if (!uninstall) cleaned.push({ hooks: [{ type: "command", command: hookScript }] });
  if (cleaned.length) settings.hooks[event] = cleaned;
  else delete settings.hooks[event];
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(
  uninstall
    ? `Removed the Orbit hooks from ${settingsPath}.`
    : `Added Orbit hooks for ${EVENTS.join(", ")} to ${settingsPath}.\nRestart running Claude Code sessions once.`,
);
