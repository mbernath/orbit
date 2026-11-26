// Composition root: the core plus the sources (ADR-0007). No logic of its own.
import { dirname } from "node:path";
import { createCore } from "./core/core";
import { defaultRunner, defaultSpawner } from "./core/runner";
import { loadHookToken } from "./core/security";
import type { Runner, Spawner } from "./core/types";
import { createAgentsSource } from "./sources/agents";
import { createClaudeSource } from "./sources/claude";
import { createFilesSource } from "./sources/files";
import { createGitHubSource } from "./sources/github";
import { createListsSource } from "./sources/lists";
import { createOwnedSource } from "./sources/owned";

export type OrbitOptions = {
  home: string;
  port: number;
  hostname?: string;
  claudeProjects?: string; // default ~/.claude/projects
  claudeHome?: string; // Claude Code's settings, read for run defaults (ADR-0025); default: the folder above claudeProjects, else ~/.claude
  github?: boolean; // default true; false disables all GitHub calls
  githubIntervalMs?: number; // default 60 s; 0 disables polling
  run?: Runner; // command runner for git/gh, replaceable in tests
  spawn?: Spawner; // long-running processes (owned sessions, ADR-0019), replaceable in tests
  claudeBin?: string; // Claude Code CLI for owned sessions, default "claude"
  boardToken?: string; // fixed board token, for tests
  claudeImportMs?: number; // transcript catch-up for lost hook events, default 60 s; 0 disables it
  filesPollMs?: number; // default 2 s; 0 disables polling (tests call pollFiles)
  agentsTickMs?: number; // schedule check, default 30 s; 0 disables it (tests call tickAgents)
  listsTickMs?: number; // list refresh check (ADR-0036), default 30 s; 0 disables it (tests call tickLists)
};

export async function createOrbit(opts: OrbitOptions) {
  const github = opts.github === false ? null : createGitHubSource({ intervalMs: opts.githubIntervalMs });
  const files = createFilesSource({ pollMs: opts.filesPollMs });
  const agents = createAgentsSource({ bin: opts.claudeBin, tickMs: opts.agentsTickMs });
  const lists = createListsSource({ tickMs: opts.listsTickMs });
  const claudeHome = opts.claudeHome ?? (opts.claudeProjects ? dirname(opts.claudeProjects) : undefined);
  const sources = [
    createClaudeSource({ projectsDir: opts.claudeProjects, claudeHome, importMs: opts.claudeImportMs }),
    files,
    createOwnedSource({ bin: opts.claudeBin, claudeHome }),
    agents,
    lists,
    ...(github ? [github] : []),
  ];
  const core = await createCore({
    home: opts.home,
    port: opts.port,
    hostname: opts.hostname,
    run: opts.run ?? defaultRunner,
    spawn: opts.spawn ?? defaultSpawner,
    sources,
    boardToken: opts.boardToken,
  });
  return {
    ...core,
    hookToken: loadHookToken(opts.home),
    refreshGitHub: () => github?.refresh() ?? Promise.resolve(),
    pollFiles: () => files.poll(),
    tickAgents: (now?: number) => agents.tick(now),
    tickLists: (now?: number) => lists.tick(now),
  };
}
