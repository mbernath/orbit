# ADR-0036 — Lists on an island come from scripts through one contract

**Status:** Accepted · 2026-11-24

## Context

The user wants to see per island what is currently to do. Where that lives differs per project — GitHub Issues, Projects, a CRM, a text file — and so does its shape (epics with sub-issues, Now/Next/Later labels, deal stages). Orbit should not learn each of these systems.

## Decision

- **Orbit shows lists; the island brings the data.** A *list node* on an island is configured in Orbit with a shell command, a title and a refresh interval. The command lives wherever the repo wants it; nothing is mandatory. An island may have several list nodes; **one node shows exactly one list**.
- **The contract is agnostic.** Orbit knows no epics, bugs, horizons or deals — only sections, items, a tree, a fixed set of states and free badges. Meaning comes from the script's wording.
- **Invocation:** run in the island's directory with `ORBIT_LIST_VERSION=1` in the environment; stdout is one JSON document (below), stderr is log only, exit code ≠ 0 or a timeout (30 s) is a failure. On failure Orbit keeps the last good result and marks it stale. The script may report a user-facing failure as `{"version":1,"error":"…"}` (German, shown verbatim).
- **Read-only.** Orbit never writes back through the script. Clicking an item opens its `url`.
- **The script owns the order** — of sections, of items, of children. Orbit never re-sorts; it only marks (e.g. blocked).
- **Configuring the command is the consent** to run it; no extra trust dialog.

### Document, version 1

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | `1` |
| `title` | no | default title of the node |
| `summary` | no | `{ text, tone? }` — one line that replaces Orbit's derived summary at the farthest depth |
| `sections` | no | ordered `[{ id, title, collapsed? }]`; without it, one implicit section |
| `items` | yes | ordered top-level items |
| `error` | no | user-facing failure; then `items` may be missing |

Item:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | stable across runs (change markers, fold state) |
| `title` | yes | plain text |
| `section` | no | section id; top-level only, children inherit it |
| `state` | no | `open` (default) · `active` · `blocked` · `done` — drives glyph and colour only |
| `stateLabel` | no | the script's own word for the state ("In Review") |
| `ref` | no | short handle to cite the item in text, e.g. `#396`, `ORB-12` (added later, see below) |
| `url` | no | http(s) link to the source |
| `note` | no | short plain text, shown in the panel |
| `badges` | no | `[{ text, tone? }]`, free labels (assignee, label, due date, amount) |
| `children` | no | nested items, same shape; any depth allowed, the board shows two levels |

`tone` is one of `neutral` (default) · `accent` · `good` · `warn` · `bad`. Unknown fields are ignored, so scripts can carry more than v1 shows.

**Derived summary** (when `summary` is absent): count per section, blocked count highlighted, `done/total` for items with children.

### Adding a list

- Its own item **"Liste anheften …"** in the island menu, not part of "Datei anheften": pinned files stay limited to `.md` (ADR-0009, ADR-0011), and a list is a command (with arguments or pipes), not necessarily a file.
- The form takes a command, typed or picked with the native file dialog (`lists.pickScript`, like ADR-0035; a path inside the island becomes `./relative`). Orbit runs it once as a trial (`lists.test`) and shows "13 Einträge in 3 Abschnitten, 1 blockiert."; **"Anheften" is enabled only after a good trial run**. Title (default: the script's `title`) and interval (1/5/15/60 min or by hand, default 5 min) are optional.
- Command, title and interval are edited in the panel under "Einstellungen".
- **Guide for script authors:** [docs/list-contract.md](../list-contract.md) is self-contained (no Orbit internals), so it can be handed to a session in another repo. The form's link "Anleitung für Scripts kopieren" puts it on the clipboard (served at `GET /api/lists/guide`). It is English, since a developer or a Claude session reads it; error texts the script prints stay German.

## Consequences

- A new source `lists` (`src/sources/lists/`: `contract.ts` pure parsing, `index.ts` runs, storage, actions), entities `list:lists/<id>` with an explicit workspace, view `list` and panel body `panel-list.js`. **No core change**: the command runs through the existing `Runner` as `/usr/bin/env ORBIT_LIST_VERSION=1 /bin/sh -c <command>`, the timeout is a race in the source (debt #35).
- The last good list is stored in `lists_nodes`, so a restart shows it at once.
- Scripts run local code with the user's credentials — fine, since the user configures each command themselves. A changed script is not detected in v1.
- Polling, not push: refresh on interval and on demand. Lists change slowly; a streaming script can come later.
- `scripts/orbit-list-demo.sh` emits dummy data in this format and is the reference until a real script exists.

## Amendment 2026-11-24: `ref`

The user cites items in text ("see #396") and had to open the source to learn the number. An item may now carry `ref`, a short handle (≤ 40 characters) in the source's own notation. The board shows it before the title, muted and monospaced; a click copies it. It stays in version 1: the field is optional and older Orbit versions drop unknown fields, so no script and no board breaks. Orbit does not derive it from `url` — that would teach a generic contract about GitHub.

## Alternatives

- **Orbit integrates GitHub Projects, CRMs etc. directly:** one integration per system, each with its own model — exactly what this avoids.
- **A fixed field "horizon" (now/next/later):** too specific for non-software projects; sections cover it.
- **Several lists per node:** a more complex contract for no gain; two nodes do the same.
- **A file in the repo instead of a command:** a command can query live sources; a script that only `cat`s a file is still allowed.
