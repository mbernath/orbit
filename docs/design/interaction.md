# Interaction

## Pointer

| Where | Click | Drag | Double-click |
|---|---|---|---|
| Dot or name | open detail panel (⇧: add to / remove from the selection) | move element (within its island; beyond the edge grows the island once); a selected one moves the whole selection; the dot snaps to a 16 px grid, ⌥ turns it off | — |
| Bubble | reply in the bubble | move element | (document text) edit |
| Ring beside a hovered session | — | draw a link to another session, then choose its type | — |
| Link line | menu: type, direction, remove | — | — |
| Free space in an island | activate the island; close the panel | pan | — |
| Free space outside islands | deactivate; close the panel | pan | new island |
| Island name | open the island panel | move the island with its content | island panel with the name selected to rename |
| `+` beside island name | add menu: session, agent, file, list | — | — |
| Island corner | — | resize | — |
| Free space, with ⇧ | — | rectangle: selects every element whose dot lies inside (adds to the selection) | — |
| Edge hint | navigate to the element (on press) | — | — |
| Minimap | centre there (tucked: unfold, end reply) | move the view | — |
| PR number / pill | open the PR on GitHub in a new tab; a stack (several PRs) lists them in a small menu, each opening GitHub | — | — |

Trackpad: two-finger swipe pans, pinch zooms. Mouse: wheel pans, ⌘/Ctrl + wheel zooms. A scrollable bubble or document scrolls instead of panning.

## Keyboard

**There is always exactly one active island.** It follows the last move: the island under the pointer, or the island of the element the keyboard (W / Q, Enter) or a click went to; with none of these yet, the island taking the most room on screen. Only the active island shows its "+", and N starts a session there.

Shortcuts act when the board has focus and nothing is being typed. A button on the board (such as an island's "+") counts as the board, except that Enter and Space activate the button; an open menu, a dialog and the panel keep their own keys. No digit keys (browsers such as Vivaldi use them for tabs). Vivaldi's spatial navigation can also be bound to single letters (W among them): it then draws orange rings on labels, buttons and fields while the page's focus never moves (whether W / Q's `preventDefault` stops it is unverified). If keys "highlight the wrong thing", check the browser's keyboard settings before the board.

| Key | Action |
|---|---|
| ← ↑ → ↓ | pan |
| ⇧ + arrow | focus the nearest element in that direction |
| W / Q | next / previous element that needs the user (waiting, permission request, or its PR needs them), in reading order: islands top to bottom, left to right, then by position inside the island |
| G, then letter | show island |
| + / − | zoom one level in / out |
| Space | reply in the bubble |
| Enter | open detail panel |
| A / D | allow / deny a permission request |
| ⌘⇧S | Snooze (waiting) / Seen (done) — on the open element in the panel, also while typing, else on the focused or hovered one (ADR-0043) |
| N | new session in the active island; it is brought into view and outlined while the form is open, whose title names it ("New session in orbit") |
| V, arrows, Enter | link to another session |
| F2 | rename |
| Entf / ⌫ | take off the board |
| ⌘⇧⌫ | take the open element off the board, also while typing in the panel |
| ⌘Z | undo the last removal, group move, alignment or distribution |
| with a selection: ← ↑ → ↓ | move it one grid step (⇧: ten) instead of panning |
| with ≥ 2 selected: ⌥ + arrow, ⌥H, ⌥V | align left / right / top / bottom, centre horizontally / vertically (per island, on the dot) |
| with ≥ 3 selected: ⌥⇧H, ⌥⇧V | distribute evenly between the outermost two (per island) |
| ⌥ Space or M | listening on/off (voice; open topic) |
| ? | shortcut overview on/off (anywhere, except while typing) |
| Esc | closes the innermost thing: menu, reply, rename, panel, selection. Never zooms. |

In a reply field: Enter sends, ⇧Enter new line, ⌘Enter allows a pending request, ⌘⇧Enter sends and moves on (see below), Esc leaves — in an empty field Esc closes the panel at once.

The panel's reply field usually has focus, so keys in the panel always carry ⌘ or ⌥; single letters never act there. Keys that work everywhere are ⌘⇧ combinations: ⌘⇧S, ⌘⇧F, ⌘⇧⌫ (and ⌘⇧Enter in the reply field). Single-letter keys stay board keys. Rare or irreversible actions (Merge …, Take over …, Remove island …) get no key: Tab and Enter reach them (ADR-0043).

## Detail panel

- Opens on the right; the board narrows, the camera does not move (unless the opened element's dot would be hidden behind the panel — then the board shifts just enough).
- Closes with ×, Esc (also from inside the panel), or a plain click on the canvas. Clicking another element switches to it.
- Width: drag the left edge (360 px up to 90 % of the window); double-click on the edge restores the default. ⤢ in the header or ⌘⇧F (also while typing) switches to full width — the board is hidden, text stays at about 80 characters per line. Width and full mode are remembered in this browser and survive switching elements.
- Reply field: grows with its text up to about 40 % of the panel's height, then scrolls; a handle above it drags it taller, and that height is remembered.
- ⌘⇧Enter in the reply field sends and opens the next element that needs the user (same order as W) in the panel, cursor in its reply field, width unchanged. Nothing left: the panel closes, the board has focus, the status line says "All done". If sending fails, it stays and keeps the text.
- Everything the bubble offers is also in the panel (principle 8).
- Copy on hover: hovering a message shows ⧉ beside it, which copies the message as its Markdown source ("Copy as Markdown"); hovering a code block — in messages and in documents, also on the board — shows ⧉ in its corner, which copies just the code. The icon turns ✓ ("Copied") for a moment. Copying never opens the editor.
- File references in text (links to local files, paths in inline code, ADR-0030) are dotted links; a click opens the file — code in VS Code at the line, HTML, PDFs, images and folders in their default app. Errors go to the status line.

## Menus and confirmations

- Small menus at the control that opened them; arrow keys and Enter; Esc closes.
- Dialogs (ADR-0042): one component. Forms from a menu open anchored at its control; pin file, merge and file preview open centred over a dimmed board. Title, optional subline, fields with placeholders, then Cancel and the primary button on the right. Enter submits (⇧Enter is a new line in a text field), Esc and Cancel close, an error stays in the dialog above the buttons.
- Irreversible or outward actions ask **in place**, once: Merge … → "Squash and merge, delete branch?" → Merge / Cancel. Take over … → warning → Take over / Cancel. Remove island … → only when empty → "Remove “name”?" (a second click confirms).

## Undo

Taking an element off the board and removing an island show a status line "… removed from board · Undo" for 8 s; ⌘Z does the same. Taken-off elements stay reachable in the island panel ("Removed from board · n"). Removing a session with its own worktree additionally offers "Also remove worktree" (never automatic).

## Voice (open topic)

Global listening indicator at the top ("Orbit is listening → target"); the text goes to whatever has focus (open panel, reply bubble, selected or hovered session); with no focus the first words name the target. No microphone buttons, no hints below fields. Engine (Spokenly vs. Parakeet in Orbit) undecided.

## Selection (ADR-0034)

- ⇧ + drag on free space or ⇧ + click on a dot selects; Esc or a plain click on free space clears it. Selected dots carry a dashed ink ring.
- With two or more selected, a bar at the top of the board shows "n selected" and the align / distribute buttons (keys in the table above). Each island is arranged on its own; nothing ever changes island.
- ✓ ⇧-dragging over an island selects its elements and none of another island; "Oben ausrichten" puts the selected dots on one line; dragging one selected dot moves all by the same amount; ⌘Z undoes it; Esc clears the selection.
