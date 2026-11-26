# ADR-0019 — Owned sessions run through the headless Claude Code CLI with the user's own login

**Status:** Accepted · 2026-11-22 · amends [ADR-0010](0010-observed-and-owned-sessions.md) (how owned sessions run), [ADR-0016](0016-agent-triggers.md) and [ADR-0017](0017-worktrees-and-model-choice.md) (where they name the Agent SDK)

## Context

Slice 4 lets Orbit start, resume and steer its own sessions. ADR-0010 assumed the Claude Agent SDK. Before adding it we checked billing and terms (official docs, 2026-11-22):

- The SDK and `claude -p` both draw from the Claude subscription when the user is signed in with a plan (support article "Use the Claude Agent SDK with your Claude plan"). The SDK docs themselves steer developers to API keys and forbid *third parties* from offering claude.ai login in their products.
- The legal page explicitly allows "an end user … signing in to the unmodified Claude Code binary with their own Claude subscription", and forbids collecting, storing or intermediating Claude credentials or tokens. Subscription limits assume "ordinary, individual usage".
- In `-p` mode an `ANTHROPIC_API_KEY` in the environment always wins over the subscription; `--bare` never reads the subscription login.
- `claude -p` offers what slice 4 needs: `--output-format stream-json` / `--input-format stream-json`, `--session-id <uuid>`, `--resume <id>` (also for sessions started interactively), `--model`, `--permission-mode`, `--permission-prompt-tool`.

Orbit is a personal, single-user, local tool (ADR-0002).

## Decision

- **Owned sessions are `claude -p` child processes** of the Orbit server, started with the user's own Claude Code login. No Agent SDK dependency.
- **Credentials are never touched:** Orbit does not read, copy or store tokens or `~/.claude` credentials; the CLI authenticates itself.
- **Child environment:** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed, `--bare` is never used — so usage runs on the subscription, as the user sees in Claude Code. An API key is used only if the user configures one for Orbit explicitly (fallback, see below).
- **Process handling in a new source `src/sources/owned/`** behind a streaming extension of the runner (`spawn` with line-wise stdout and a writable stdin), stubbed in tests like `run` today. Events from the stream (assistant text, tool steps, permission requests, result) become the owned session's state; transcripts and hooks still work as for observed sessions.
- **Orbit assigns the session ID** (`--session-id`). **Take over** = `--resume <id>` after confirmation (ADR-0010). Only **one process per session** at a time; messages to a busy session are queued, because concurrent runs on one session lose messages.
- **Permissions:** runs start in the CLI's default (manual) mode; requests reach the board through `--permission-prompt-tool` (or a hook) and are answered with Erlauben / Ablehnen (ADR-0009). No `bypassPermissions`.
- **Model and effort** via CLI flags (ADR-0017). **Trigger reading** (ADR-0016) is one short `claude -p` call with a small model and no tools.
- **Fallback:** if subscription use for this is restricted later, Orbit switches to an API key the user enters (Commercial Terms, billed per token); nothing else changes.

## Consequences

- No new dependency; the CLI is already installed and logged in. Behaviour follows the CLI version the user has installed — the stream format is the SDK's wire format and may change, so parsing is tolerant and covered by fixture tests.
- Usage counts against the user's subscription limits (5-hour and weekly windows). Agents that run often can exhaust them; the board shows a run's error instead of retrying.
- Orbit must keep running for owned sessions; on restart it marks them interrupted and can resume them by ID.
- Orbit stays single-user. Sharing it, or running it for others on their logins, is not allowed under this decision.

## Alternatives

- **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).** Typed API around the same CLI. Rejected for now: a dependency (ADR-0002), and its docs point to API keys, which makes the subscription path less clearly sanctioned than running the unmodified CLI. Can replace the process layer later without changing the source's entities.
- **API key from the start.** Clear terms, but every run costs money (roughly 0.50–2 USD per Sonnet coding session) while the subscription is already paid.
- **Injecting into running terminals or IDEs.** Rejected in ADR-0010.
