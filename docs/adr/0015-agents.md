# ADR-0015 — Agents are lasting entities; each of their runs is a session

**Status:** Accepted · 2026-11-22 · builds on [ADR-0008](0008-canvas-model.md) and [ADR-0010](0010-observed-and-owned-sessions.md) · implemented by [ADR-0020](0020-agents-source-core-contracts.md)

## Context

Besides task sessions ("implement issue #111"), the user wants agents that do recurring work: keep the roadmap current, review every new PR. Technically both are Claude conversations with tools and permissions; what differs is lifetime and trigger. A task session ends when its work is in `main`; an agent has a role, keeps its own memory across many runs and is started by a schedule, an event or a message, not only by the user.

## Decision

- **Entity kind `agent`** (`agent:<source>/<id>`): role (one sentence), trigger (schedule, event such as "after every merge into main" or "on every new PR", or manual), memory location, owner kind (`owned` or `remote`, ADR-0010).
- **A run is a session** with `parent` set to its agent. Runs carry the trigger that started them. They appear on the board only inside the agent (its bubble and detail panel), not as separate dots — unless a run needs the user, which lifts the agent into attention.
- **On the board** an agent is a dot with a small moon: the moon is the lasting identity, the dot shows the current run with the same states as a session (working, waiting, resting). Its bubble shows role and trigger at depth 2 and the last runs at depth 3; "Jetzt ausführen" starts a manual run. Talking to an agent is talking to it, not to one run: the message starts or continues a run.
- **Effects show where they land:** when a run changes a document or memory, that element reports the change in its own bubble ("Neu · von Roadmap-Pfleger").
- Agents are taken off the board like sessions (ADR-0005); their definition stays until deleted.

## Consequences

- One mental model: everything that talks is a conversation; agents add a lasting identity and a trigger on top.
- Needs an event bus for triggers (merge, new PR) — the core already has one (ADR-0007); schedules need a timer in the core or a cloud routine.
- Run history can grow large; the board shows only the last few runs.

## Alternatives

- **No distinction, agents are long-running sessions.** Context windows end and triggers have nowhere to live; the board would show one ever-growing conversation.
- **Each run as its own dot.** Floods islands with short-lived dots and loses the "this is the roadmap agent" identity.
