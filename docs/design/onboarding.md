# First run and onboarding

The first minutes with Orbit ([ADR-0041](../adr/0041-first-run-and-onboarding-hints.md)). Everything is derived from state the board already has, except which hints are done (`localStorage`).

## Stage 1 — no island yet

Centred on the empty canvas, quiet, no frame:

- One line, what Orbit is: **"All your Claude Code sessions in one place — and the ones that need you."**
- **"Start with a project you work in:"** and up to five suggestions, most recent first. Each is a button: folder name bold, then `~/path` muted, then "42 sessions, 9 this week · 2 days ago" ("this week" = the last 7 days; left out when 0). One click adds the island named after the folder.
- **"Choose another folder …"** below, opens the existing new-island form (name, path, folder dialog).
- No suggestions (no transcripts): only the line and "Choose a folder …".

The old text ("No sessions yet …") is gone. The text for an island whose elements were all removed stays as it is.

**Acceptance:** with an empty data folder and a fixture of three transcript projects, the board shows three suggestions in order of last use with their counts; a click creates the island and its imported sessions appear on it without reload. While this screen shows, the board chrome that needs islands is hidden (zoom dots, minimap, edge hints) and zoom keys and wheel zoom do nothing.

## Stage 1b — choosing what comes along

No dialog before the click ([ADR-0041](../adr/0041-first-run-and-onboarding-hints.md), amendment): Orbit acts with a sensible default, says what it did, and makes changing it one click.

- An island created from a suggestion keeps the sessions of the last 7 days on the board, at most the 12 most recent. The older imported ones are removed from board (archived) — still in the island panel under "Removed from board".
- Then one quiet line just below the island, in the guide look (guide-bg pill, guide dot, a pointer up to the island, see "Look"): **"9 recent sessions · 33 older ones kept off the board — Keep · Show all · Show none"**. Singular "1 recent session", "1 older one"; with no recent session: "No recent sessions · 33 older ones kept off the board — Keep · Show all".
- **Keep** comes first and is the primary choice (bold): the default is fine, the line just closes. **Show all** brings the older ones back; **Show none** removes the recent ones too. Both say what happened with Undo, like other removals.
- The line goes after a choice, or at the first other interaction with the board (click, key, opening a panel or menu). It is not stored: a reload does not bring it back.
- While the line shows, it is the guide on the board (no hint beside it). **The moment it closes — in any way — the first hint ("open") appears**, without reload or another interaction, so the first run never stalls on the line.
- Nothing kept off (12 or fewer, none older): no line. Islands added through "Choose another folder …" or a double-click on free space import everything as before.

**Acceptance:** with a fixture folder of 3 recent and 15 older sessions, the suggestion reads "18 sessions, 3 this week · 1 day ago"; one click shows only the 3 recent on the island and the line "3 recent sessions · 15 older ones kept off the board — Keep · Show all · Show none"; "Keep" closes the line and the "open" hint shows right after; on a fresh island "Show all" shows all 18 and the line is gone; on a fresh island from the same folder "Show none" leaves no session on the board and the line is gone.

## Stage 2 — island, but no hook installed

A quiet line at the top (same place and look as the stale-hook notice, but muted, not warning colours) with a small guide-coloured dot in front, so it reads as part of onboarding: **"Live status needs Claude Code's hook. In the Orbit folder, run `bun run hooks:install`, then restart Claude sessions."** It disappears when the check sees the hook (on focus, as today). The stale notice (ADR-0031) wins when both would apply.

**Acceptance:** with `installed: false` and one island the line shows; with the hook installed it is gone.

## Stage 3 — hints

One hint at a time, a small pill in the guide colour (see "Look") next to the thing it is about, never covering a session's own text. Shown when its moment comes, gone for good once its action happened — also when the user did the action before the hint ever showed.

| Hint | Moment | Text | Retired by |
|---|---|---|---|
| tidy | once after the list layout arrived, at an island that keeps hand-moved dots (canvas.md "One-time tidy") | at that island's name: "Tidy island: click the name" | opening that island's panel (also by using Tidy island) |
| open | first session dot visible | "Enter or click opens it" | opening any panel |
| snooze | a session waits for the user | "⌘⇧S snoozes · Space replies" | pressing ⌘⇧S anywhere, or Space on a session |
| jump | two or more things need the user | "W jumps to the next one that needs you" | pressing W or Q |
| island | panel was opened once, the island "+" not used yet | at the "+": "Add a session, agent, file or list" | opening an island's "+" menu |
| keys | the three above are done | bottom right, beside the zoom dots: "? all keys" | opening the shortcut overview |

Rules: hints never show in the atlas level or while a menu or dialog is open; an open panel hides hints on the board behind it. `?hints=reset` in the URL clears the progress.

**Acceptance:** an e2e test walks the table in order — each hint appears at its moment, disappears after its action, and does not come back after a reload.

## Look

Onboarding has its own signal colour, `--guide` (magenta: light `#c0398f` on `--guide-bg` `#fbe8f3`, dark `#f08ac8` on `#4a1d3a`), so it never reads as a session state (accent violet, working green, waiting orange, done blue, fail red, idle grey). **The colour is reserved for onboarding** — nothing else uses it. A hint is an **anchored callout**, so it is clear what it belongs to:

- **The pill:** guide-bg background, guide text at 12.5px, a 6px guide dot before the text, and a small notch (pointer) on the side facing its target. It sits directly at the thing it is about, 8px away: beside a session's name (pointer left, or right when the name sits left of its dot) — or, where that would cover another session's name or bubble, above or below its dot (pointer down or up) — above the island "+" (pointer down), left of the zoom dots (pointer right). It fades and scales in once when it appears.
- **The target gets a halo:** a guide-coloured ring around the session dot, the island "+" (which then stays visible) or the zoom dots. When the hint appears the ring pulses gently three times, then stays as a still ring until the hint is retired or gives way to another. With reduced motion: no fade, no pulse, only the still ring.
- The import line (stage 1b) uses the same language: guide pill with a pointer up to its island.

The no-hook line keeps its quiet look and only gets the dot. Top notices (the no-hook line, the stale-hook notice) are never covered by a fitted island: fitting the view to the islands leaves room below a visible notice.

## Testing it by hand

`bun run fresh` starts a throwaway Orbit on port 4748 with an empty data folder (your transcripts are read, never written; GitHub off). Your real Orbit on 4747 is not touched. It prints `http://127.0.0.1:4748/?hints=reset`: hint progress lives in the browser per origin, so without the reset the hints you retired last time stay away. To send one live session there: `ORBIT_URL=http://127.0.0.1:4748 ORBIT_HOME=<folder it prints> claude`.

`bun run fresh --demo` also plays live sessions into it, as hook events like `hooks/orbit-hook.sh` sends, in the most recent suggested folder — they show on that island once you create it from the suggestion. Session A starts working at once; about 20 s later B asks to run `npm test` (waiting: the snooze hint); about 40 s later C finishes (done: two things need you, the jump hint). Every few minutes it starts over with new sessions, until Ctrl-C. The sessions have no transcripts. If 4748 is taken, `ORBIT_FRESH_PORT=4749 bun run fresh --demo`.

Feedback goes to `docs/design/onboarding-feedback.md` — pin it in your own Orbit and write as you go.
