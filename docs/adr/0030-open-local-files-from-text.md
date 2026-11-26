# ADR-0030 — Local file references in rendered text open the file

**Status:** Accepted · 2026-11-23 · builds on [ADR-0009](0009-actions-and-local-security.md), [ADR-0011](0011-markdown-files.md), [ADR-0029](0029-markdown-it-renderer.md)

## Context

Claude refers to local files all the time, the way it does in VS Code: `[storyboard.html](file:///Users/…/storyboard.html)`, `[core.ts](src/core/core.ts#L127)`, or an inline `` `web/js/panel.js:270` ``. The board rendered all of these as plain text (only http(s) links are anchors), and a `file://` anchor would not help anyway: a page served over `http://127.0.0.1` may not navigate to `file://`. To check what Claude means, the user had to find the file by hand.

## Decision

**Recognised in rendered Markdown** (`web/js/markdown.js`):
- link targets that are `file://` URLs, absolute paths (`/…`), home paths (`~/…`) or relative paths (no URL scheme);
- inline code that is clearly a path: contains a `/` and ends in a file name with an extension, optionally `:line`, e.g. `` `src/core/core.ts:127` ``;
- a line suffix in any of the forms `#L42`, `#L42-L50`, `:42`, `:42:7`, `:42-50`.

Relative paths need a base: the session's working directory for conversations, the file's folder for documents. Without a base they stay plain text. A recognised reference renders as an anchor with `data-file` (and `data-line`, `data-base`), not as a URL.

**Opening is an action**, `files.open` (risk `local`, actor `board` only — agents never open files on the user's screen):
- The server resolves the path (base, `~`, `file://`, URL decoding), resolves symlinks, and applies the ADR-0009 limits that matter for reading: inside a workspace path, never inside `.git` or `~/.claude`. Any file type and folders are allowed — opening shows a file, it never changes it.
- **Which app:** documents a browser or viewer shows better (`.html`, `.htm`, `.pdf`, images, `.svg`) and folders go to macOS `open` (default app, Finder). Everything else opens in VS Code at the line (`code -g path:line`); if `code` is not available, `open` is the fallback.
- The board shows the action's German error ("Datei nicht gefunden.", "Datei liegt in keinem Workspace.") in the status line.

## Consequences

- References in conversations, in documents in the panel and on the board are one click away.
- Inline code that looks like a path but is not a file (e.g. a URL path `api/v1/x.json`) becomes a link that answers "Datei nicht gefunden." — accepted, because recognising paths only when they exist would need a server round trip per render.
- Files outside every workspace (e.g. a worktree outside the workspace paths, `~/.claude/plans`) do not open. Widening that is a separate decision.

## Alternatives

- **Markdown files open as documents on the board** instead of in VS Code. Keeps the user in Orbit, but pins a file onto the canvas as a side effect of reading. Revisit with a read-only preview in the panel.
- **Recognise paths in plain text too.** Too many false hits in prose; Claude marks paths as code or links anyway.
- **Serve the file through Orbit and open it in a browser tab.** Only helps for HTML and images, and would widen the read surface of the HTTP server.

## Amendment 2026-11-24 — relative paths fall back to parent folders

Claude often `cd`s into a subfolder and still writes paths relative to the repo root (`assets/graphics/x.png` with cwd `…/assets/graphics`). `files.open` therefore tries a relative path against the base first, then against each parent of the base, and opens the first candidate that exists and passes the location limits. The base still wins when both match. If none matches, the error is the one for the base itself.
