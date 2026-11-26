# ADR-0040 — A click on a file reference previews it in Orbit

**Status:** Accepted · 2026-11-24 · amends [ADR-0030](0030-open-local-files-from-text.md) (its "Serve the file through Orbit" alternative is now taken, within the limits below)

## Context

ADR-0030 made every file reference in rendered text open the file in an outside app. In practice most clicks only check what Claude means — a picture it made, the line it changed — and switching to Preview or VS Code for that pulls the user out of the board. A page served from `http://127.0.0.1` cannot show local files itself: browsers block `file://` from web pages, localhost included. So the bytes must come through Orbit's server.

## Decision

**Click previews, ⌘/Ctrl-click opens.** A click on a file reference opens a read-only preview over the board; ⌘/Ctrl-click keeps ADR-0030's behaviour (open in the default app or VS Code at the line). The preview's header always offers *Open*, *Show in Finder* and *Copy path*; Esc or a click outside closes it.

**Per type:**
- images (`png`, `jpg`, `gif`, `webp`, `svg`, …): the image, fitted; a click toggles 100 %;
- PDF: the browser's own PDF viewer;
- Markdown: rendered like documents, references inside are links again;
- code and text: monospace with line numbers, scrolled to and marking the referenced line;
- HTML, folders: no preview — a click opens them as before (HTML would run with the board's origin; Finder is the better folder view);
- anything else, or too large (> 2 MB): name and size, with the three buttons.

**Server:** `GET /api/files/raw?path=…&base=…` in the files source (no core change). It needs the board token — the board fetches with the header and shows a blob URL, so the token never appears in a URL. The path is resolved exactly like `files.open` (base, then its parent folders, ADR-0030 limits: inside a workspace, never `.git` or `~/.claude`). Only the content types above are served, with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; the resolved path comes back in `X-Orbit-Path`. Other types answer 415 with name and size.

**Show in Finder** is `files.open` with `reveal: true` → `open -R`.

## Consequences

- Checking a file costs one click and no app switch.
- The HTTP server can now read files, not only Markdown. The read surface is bounded by the same location limits as `files.open` plus a type list and the token.
- SVG is shown as an image, so scripts inside never run.

## Alternatives

- **Show local files directly (`file://`).** Not possible from a web page; it would need a native wrapper (Electron, Tauri), which contradicts ADR-0002.
- **Preview inside the detail panel.** The panel belongs to an element; a referenced file usually has none, and the conversation the user is reading lives in the panel.
- **Token as query parameter for `<img src>`.** Simpler, but the token would end up in logs and history.
