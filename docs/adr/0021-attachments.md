# ADR-0021 — Attachments in messages to owned sessions

**Status:** Accepted · 2026-11-22 · builds on [ADR-0019](0019-owned-sessions-via-claude-cli.md)

## Context

The user often attaches screenshots and files when talking to Claude. Owned sessions take messages as stream-json lines on stdin (ADR-0019). A probe on 2026-11-22 confirmed that a user message may carry an image content block (`{"type":"image","source":{"type":"base64","media_type":"image/png","data":…}}`) next to the text, and that Claude reads it. Other file types were not probed.

## Decision

- The reply field (detail panel) and the "Neue Session" form accept attachments: drag and drop, paste (⌘V) and a file button. At most 10 files, 10 MB each.
- **Images** (PNG, JPEG, GIF, WebP) go to Claude as image content blocks, inline in the message.
- **Every other file** is stored by Orbit under `~/.orbit/attachments/<session id>/` (name made safe, never outside that folder) and named to Claude by its path in the message ("Anhang: …"). Claude reads it with its own tools; a path outside the project asks for permission as usual.
- Attachments travel base64 in the action input (`owned.start`, `owned.send`). The action layer logs inputs, so the core shortens long strings in the event log instead of storing file contents there.
- Orbit never deletes attachments on its own; they stay with the session's folder in `~/.orbit`.

## Consequences

- One path for all attachment types; images need no extra permission, files may.
- `~/.orbit/attachments` grows with use (see debt list).
- Observed sessions get no attachments: Orbit does not write into sessions it does not run (ADR-0010).

## Alternatives

- **Files as document content blocks.** Possibly works for PDFs, but unconfirmed for the CLI's stream input and not for arbitrary file types; can be added per type after a probe.
- **Copy files into the project folder.** Claude could read them without asking, but Orbit would write into the user's repos.
