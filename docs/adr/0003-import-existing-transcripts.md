# ADR-0003 — Existing sessions are imported read-only from Claude Code transcripts

**Status:** Accepted · 2026-11-20

## Context

Hooks only report sessions that run after the hook was installed. Older sessions — the ones the VS Code history shows — were invisible. Claude Code keeps every session as a JSONL transcript under `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The format is internal and undocumented.

## Decision

- On server start, for every workspace path, and when a workspace is added, Orbit scans the matching project directories and creates a session per transcript with status `history`.
- Only transcripts whose real `cwd` lies inside a workspace path are imported (the directory name encoding is lossy, so it only pre-filters).
- **Orbit never writes to `~/.claude`.**
- Hook data wins: the import only fills empty fields of an existing session and never changes its status. A hook event makes a historical session live again.
- `mtime` and size per file are stored; unchanged files are skipped on the next scan.
- The parser is tolerant: unknown or broken lines are skipped.

## Consequences

- The board shows the full history right after a workspace is added.
- A format change in Claude Code can silently degrade the import (missing titles); tests pin the fields we rely on.
- Sessions in worktrees outside the workspace path are only found through hooks, not through the import.
- Claude Code deletes old transcripts (`cleanupPeriodDays`); sessions already imported stay in Orbit's database.

## Alternatives

- **Import all of `~/.claude/projects`.** Floods the board with unrelated projects.
- **Read transcripts on every request instead of importing.** Simpler state, but slow with large files and loses positions and renames.
