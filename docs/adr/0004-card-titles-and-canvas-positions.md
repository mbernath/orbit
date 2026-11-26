# ADR-0004 — Card titles come from the transcript; canvas positions live in the database

**Status:** Accepted · 2026-11-20 · position part superseded by [ADR-0008](0008-canvas-model.md)

## Context

Cards showed the first prompt as title, which often reads like a command ("mach mal", "Fix tests") rather than the topic. Claude Code writes a generated topic title (`ai-title` lines) into the transcript — the name VS Code shows. The user also wants to rename sessions and arrange cards freely on an infinite canvas.

## Decision

- Three title fields per session: `title` (first prompt, fallback only), `ai_title` (latest `ai-title`/`custom-title` from the transcript), `custom_title` (set in Orbit). The board shows `custom_title ?? ai_title ?? title`.
- `ai_title` is re-read from `transcript_path` on `UserPromptSubmit` and `Stop`, and taken over by the import.
- Renaming in Orbit stays in Orbit; it is not written back to Claude Code (see ADR-0003). An empty rename resets to the automatic title.
- Canvas positions (`pos_x`, `pos_y`, world coordinates) are stored per session in SQLite via `PATCH /api/sessions/:id`. Cards without a position are laid out automatically, one lane per workspace.
- Pan and zoom are a per-browser view preference in `localStorage`.

## Consequences

- Titles describe the topic and improve as Claude refines them; renames survive restarts.
- Reading the transcript on two hook events costs a file read per turn; acceptable for local files.
- The layout is shared by every browser on the machine; the viewport is not.

## Alternatives

- **Positions in `localStorage`.** No server change, but lost when the browser data is cleared and not shared between browsers.
- **Write renames into the transcript.** Would make them visible in VS Code, but breaks the read-only rule of ADR-0003.
- **Generate titles with an LLM call.** Claude Code already does that; a second call would cost money and leave the machine.
