# ADR-0008 — Canvas model: entities, elements and views

**Status:** Accepted · 2026-11-20 (supersedes the position part of ADR-0004)

## Context

The canvas started as "one card per session" with the position stored on the session. Coming next are Markdown files, PR panels, cloud workers, agent messages, and different representations of the same thing — a session as a small card, as an expanded live view you zoom into, as a compact dot in a frame. We expect more kinds of elements and representations to appear. Tying layout to sessions blocks all of that.

## Decision

Three separate concepts:

- **Entity** — a thing from a source, read-only for the canvas. Addressed by a stable **ref** `<kind>:<source>/<id>`, e.g. `session:claude/95afe4dc…`, `file:fs/<abs path>`, `pr:github/acme/shop#7`, `worker:<source>/<id>`, `message:mcp/<id>`. Entities carry data and capabilities (which actions and views they support), never presentation.
- **Element** — something placed on the canvas: `id, ref, view, x, y, w, h, z, parent, state`. `parent` makes frames and groups (a workspace lane becomes a frame). `state` holds per-element UI data (collapsed, scroll position …). `archived_at` lives here. Several elements may show the same entity, e.g. a card in a workspace frame and a live view next to it. Later, **edges** (element → element, e.g. "agent A wrote to agent B") use the same table family.
- **View** — how an element renders, chosen per element: `card`, `compact`, `panel`, `editor`, `live`, … The board keeps a **view registry** keyed by entity kind; each view is one ES module exporting `render(entity, element)`, `update(…)`, its default size and which zoom levels it supports. Zooming into a session swaps or expands the view; it is not a different page.

**Implicit elements:** an entity without a stored element still appears, placed by auto-layout inside its workspace frame. An element row is written only once the user moves, resizes, archives or re-views it. This keeps hundreds of imported sessions from flooding the table.

**Persistence:** `elements` and later `edges` tables in the core; the canvas store exposes them through the same SSE stream as entities.

## Consequences

- New kinds and representations need no schema change: a source adds an entity kind, the board adds a view module.
- Session rows lose `pos_x`, `pos_y`, `archived_at`; a migration moves them into `elements`.
- The frontend becomes a small rendering engine (store → elements → views); that is deliberate and has to stay small.

## Alternatives

- **One table per card kind.** Simple at first, but every new kind repeats geometry and archive logic.
- **Layout stored only in the browser.** Loses arrangements across browsers and makes agent-driven layout (e.g. an agent pinning a file) impossible.
- **An off-the-shelf canvas library (tldraw, React Flow).** Powerful, but brings a build step and a framework; revisit if the own engine outgrows ~1,000 lines.
