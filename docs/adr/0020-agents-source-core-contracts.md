# ADR-0020 — Agents as a source: actions across sources, domain events, simple schedules, memory as a Markdown file

**Status:** Accepted · 2026-11-22 · implements [ADR-0015](0015-agents.md) and [ADR-0016](0016-agent-triggers.md) · builds on [ADR-0007](0007-core-and-sources.md), [ADR-0009](0009-actions-and-local-security.md), [ADR-0019](0019-owned-sessions-via-claude-cli.md)

## Context

ADR-0015 and ADR-0016 say what agents are: a lasting identity with a role and a trigger, whose runs are sessions; triggers are read once by an LLM into a fixed rule schema and then evaluated by plain code. They leave open how this fits the core-and-sources architecture. A new source `agents/` has to do two things no source can do today: start a run, which is an owned session of another source (`owned.start`), and react to things other sources notice (a PR merged, CI turned red, a session finished). Sources must not reach into each other (ADR-0007).

## Decision

**1. Sources call actions of other sources through the core.** The core context gets `act(id, input)`. It runs the action through the action layer like a request from the board: validation, permission check, entry in the event log. The actor is `system`, and an action must list `system` in `allowedActors` to accept it. Outward or irreversible actions are never allowed for `system` (ADR-0009: the system may start work, it never acts outward on its own). `owned.start` and `owned.send` allow `system`; merging, takeover and removing worktrees do not.

**2. Sources publish domain events on the core's bus.** The core context gets `publish(event)`; listeners registered with `on` receive them, as they receive `element.archived` and `workspaces.changed` today. The event types are a closed union in `src/core/types.ts`, starting with:

| Type | From | Payload |
|---|---|---|
| `pr.opened` | github | repo, number, branch, title |
| `pr.merged` | github | repo, number, branch, base |
| `ci.failed` | github | repo, number, branch |
| `session.done` | claude | session id, workspace, cwd |
| `file.changed` | files | path, workspace |

A new event type is a deliberate code change: an entry in the union plus the source that publishes it. Every published event is written to the event log. GitHub events are derived by comparing one refresh with the previous one, so they arrive with the refresh interval (up to a minute).

**3. Schedules use a small fixed schema, not cron.** `{ every: "day" | "weekday" | "week", at: "HH:MM", weekday?: 1–7 }` or `{ every: "hours", hours: N }`, always in the local time zone. The agents source keeps its own timer and computes the next due time; a run that was due while Orbit was not running is started once on the next start, not once per missed slot. No dependency.

**4. An agent's memory is a Markdown file in its workspace:** `.orbit/agents/<slug>.md`. Orbit creates it with the role as heading when the agent is created and pins it to the island, so it is an ordinary document on the board (ADR-0011) that the user can read and edit. Each run is told to read it first and to update it at the end; the run edits it with its own tools. Effects show where they land (ADR-0015): the document reports the change.

**Further, following from ADR-0015/0016/0019:**
- A run is an owned session started through `act("owned.start", { …, agent })`; its `control` entity names the agent. The board shows runs inside their agent, not as dots, unless a run needs the user.
- Reading a trigger is one short `claude -p` call (small model, no tools, JSON out) through the runner, at create and edit time only. The reading is stored with the agent and shown back in German ("Läuft: nach jedem Merge in main"); "not understood" means manual only, and the agent says so.
- Matching events against rules is plain code with tests; it never calls an LLM.
- Agent definitions live in the agents source's own table (`agents_agents`), not in files, so editing the memory file never changes the trigger.

## Consequences

- The core grows by two small, general contracts (`act`, `publish`) instead of agent-specific code. Future sources (cloud workers, MCP mailbox) use the same ones.
- Everything an agent does is visible in the event log: the event, the rule that matched, the action it caused.
- Agents run under the user's subscription (ADR-0019); frequent triggers use their limits. The agent's bubble shows when a run failed instead of retrying.
- `.orbit/agents/` appears in the repo's working tree; whether to commit it is the user's choice per repo.
- Schedules cannot express everything cron can; the schema grows when a real need appears.

## Alternatives

- **The agents source starts `claude -p` itself.** No core change, but duplicates the owned source and bypasses the action layer's checks and log.
- **Sources subscribe to each other directly.** Couples modules and breaks ADR-0007.
- **Cron expressions with a small library.** More expressive, a dependency, and harder to show back in plain German.
- **Memory only in Orbit's database.** Invisible on the board and not editable as a document; the run would need a tool to read it.
