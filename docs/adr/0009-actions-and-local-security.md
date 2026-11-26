# ADR-0009 — One action layer for every write; the local server authenticates the board

**Status:** Accepted · 2026-11-20

## Context

Orbit is moving from observing to acting: editing files, merging PRs, sending input to sessions, letting agents message each other. Today every write is an ad-hoc route. And `127.0.0.1` is not a security boundary: any web page open in the browser can send requests to `http://127.0.0.1:4747` (CSRF), and DNS rebinding can even read the responses.

## Decision

**Action layer.** Every write — inside Orbit or outward — is an action defined by a source and executed only through the core:

```ts
interface ActionDefinition {
  id: string;                         // "github.merge", "files.save", "session.send"
  risk: "local" | "outward" | "irreversible";
  allowedActors: ("board" | "agent")[];
  validate(input, ctx): Problem | null;
  run(input, ctx): Promise<Result>;
}
```

The core checks the actor, validates, requires a confirmation token from the board for `outward`/`irreversible` actions, runs it, and writes an entry to `events` (who, what, input summary, result). **Agents may only run actions whose `allowedActors` include `agent`** — at first only sending messages and writing their own memory files.

**Local server security:**
- Reject requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
- Mutating requests need `Origin` matching the board and a per-start secret token the board receives with the page; the hook endpoint gets its own token from a file in `~/.orbit` that the hook script reads.
- The MCP endpoint authenticates agents with per-session tokens.

**File access (Markdown):**
- Only files inside a workspace path, resolved with `realpath` (no symlink escape), extension `.md`, never under `.git/` or `~/.claude/`.
- Save sends the hash of the content it was based on; the server writes only if the file still has that hash, otherwise returns a conflict with the current content.
- Writes are atomic (temp file + rename) so agents never read half a file.

## Consequences

- One place to audit "what did Orbit do?" — useful for the user and for agents.
- The hook installation changes (token), so existing installs need `bun run hooks:install` once.
- Slightly more ceremony per write; that is the point.

## Alternatives

- **Trust localhost.** Fine for a read-only board, not for one that merges and edits.
- **Per-route checks.** Drifts apart with every new feature.
