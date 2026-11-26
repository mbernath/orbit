# ADR-0011 — Markdown files are pinned onto the canvas and edited with conflict protection

**Status:** Accepted · 2026-11-20 · rendering superseded by [ADR-0029](0029-markdown-it-renderer.md)

## Context

The user wants to see and edit Markdown files from a workspace on the board — a `roadmap.md` checked into a repo, or memory files through which agents will communicate later (MCP, separate ADR). Workspaces can contain thousands of Markdown files (a single project can have dozens of ADRs and research notes), so showing all of them is not an option. Agents and editors may change the same file while it is open in the board.

## Decision

- A new source **`files`** (`src/sources/files/`). Entities `file:fs/<absolute path>`, kind `file`.
- **Only pinned files are entities.** The board offers a picker ("Datei anheften") listing the `.md` files of all workspaces (recursive, skipping `.git`, `node_modules`, hidden and build folders, capped). Pinning stores the path in `files_pins`; unpinning removes the entity. Pins survive restarts.
- **Content is part of the entity** (up to 256 KB; larger files show a notice instead). Pinned files are checked for changes every two seconds by `mtime`/size and pushed to the board via SSE.
- **"Im Repo" vs. "lokal":** `git ls-files` tells whether a file is tracked; the board shows it as a badge, because saving a tracked file creates a change in that repo.
- **Saving** is the action `files.save` with the hash of the content the edit started from. It follows ADR-0009:
  - path resolved with `realpath`, must lie inside a workspace path, extension `.md`, never inside `.git/` or `~/.claude/`;
  - written only if the file on disk still has that hash, otherwise `409` and the board shows a conflict with the choice "Meine Fassung speichern" (explicit overwrite with the new hash) or "Verwerfen";
  - written atomically (temp file in the same directory, then rename).
- **Rendering:** a small built-in Markdown renderer (headings, paragraphs, lists, task lists, quotes, code, links, emphasis). It escapes everything first and only allows `http(s)` links. No dependency.
- **The document view keeps its own DOM state** (mount/update/unmount, debt #5): a draft survives SSE updates; a change on disk while editing shows a notice instead of replacing the text.

## Consequences

- Any number of Markdown files in a workspace, but only the ones the user chooses cost space and polling.
- Agents' memory files will use the same source once their location is decided with the MCP ADR.
- Saving a tracked file leaves an uncommitted change in that repo — Orbit does not commit.

## Alternatives

- **Show all Markdown files automatically.** Floods the canvas.
- **`fs.watch` instead of polling.** Editors save by rename, which breaks file watchers on macOS; polling a handful of pinned files is cheap and reliable.
- **A Markdown library (marked, markdown-it).** Better coverage, but a dependency and a sanitising concern; revisit if tables or footnotes are needed.
- **A full editor (CodeMirror).** Needs a build or a CDN; a textarea is enough to start.
