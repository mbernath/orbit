# ADR-0035 — Native folder picker for a new island

**Status:** Accepted · 2026-11-24 · extends [ADR-0009](0009-actions-and-local-security.md)

## Context

"Neue Insel" asked for the folder as typed text. The user wants a button "Ordner auswählen". A browser cannot reveal a local absolute path (`<input type="file" webkitdirectory>` gives only relative names), so the dialog has to come from the server.

## Decision

- New core action `workspaces.pickFolder` (risk `local`, actor `board`): runs `osascript -e 'POSIX path of (choose folder …)'` through the core's runner and returns `{ path }`, or `{ path: null }` when the user cancels (error -128).
- **Contract change:** `createWorkspaces` takes the `Runner`, so tests stub the dialog.
- The board fills the path field (and an empty name field with the folder's name); typing the path stays possible. Nothing is written until "Anlegen".

## Consequences

- macOS only. Elsewhere the action fails with a German hint to type the path; a Linux variant (`zenity`) can follow when needed.
- The dialog opens on the machine running Orbit — which is the same machine, since the server binds to 127.0.0.1.

## Alternatives

- **Folder browser inside the board** (server lists directories): more UI and code, an endpoint that lists arbitrary directories. The native dialog is smaller and familiar.
