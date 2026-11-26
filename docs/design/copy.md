# Copy

Everything the user reads is **English** ([ADR-0039](../adr/0039-english-product-language.md)), and so is everything Orbit writes to Claude on the user's behalf (deny messages, agent instructions, memory templates).

The audience are developers who use Claude Code. Where Claude Code, Git or GitHub already have a word for something, use **their** word — the user should recognise it, not learn ours.

## Voice

- Plain, short, active. Say what happens: "Merge", "Take over", "Remove from board" — and confirm with what happened: "… removed from board · Undo".
- Sentence case everywhere: "Pin file", "Session defaults" — never "Pin File".
- Talk to the user as "you"; Orbit never says "I" or "we".
- Name things as the user sees them, not as the system is built: "island", not "workspace frame"; "Snooze", not "acknowledge".
- No legends or explanations on the board. Explanations belong in the shortcut overview (`?`) and in placeholders that ask a question ("What should the new session in kestrel do?"). One exception: onboarding hints ([onboarding.md](onboarding.md)) — shown once at the moment of first need, gone for good once the user does the thing.
- No hints below fields ("Enter sends …"): what a field does must be discoverable.
- Errors say what is wrong and what to do: "orbit still holds 3 elements. Remove them from the board first." Patterns: "Couldn't …", "… not found.", "Invalid ….", "… are off limits."
- No apologies, no exclamation marks, no emoji.

## Recurring terms

| Term | Meaning | Not |
|---|---|---|
| island | a workspace on the canvas (the map metaphor: board, island, atlas, region) | workspace, frame |
| No island | sessions whose folder belongs to no island | unassigned, other |
| session | one conversation with Claude | chat, thread |
| agent | a lasting role with a trigger; its runs are sessions | bot |
| run / runs | one run of an agent | job, execution |
| trigger | when an agent runs ("When does it run?") | schedule, rule |
| memory | an agent's memory file | notes |
| Needs you | the attention queue | inbox |
| waiting / done / CI failing / ready to merge | reasons something needs the user (edge hints, minimap) | blocked, finished, red, mergeable |
| Snooze / Seen | silence a waiting session (key S) / acknowledge a done one | Later, Dismiss |
| Take over | continue an observed session in Orbit | adopt, import |
| Remove from board / Unpin | archive a session / unpin a document or list; both undoable | delete, hide |
| kept off the board / Show all / Show none | older sessions a first island leaves archived, and the two choices about them (onboarding stage 1b) | hidden, skipped |
| Pin file / Pin list | put a Markdown file / a list on an island | add, attach |
| Attach file | add a file to a message | upload |
| main checkout / separate worktree / folder without Git | where a session works | |
| Effort: low / medium / high | thinking effort, Claude Code's own levels (short labels in one line beside model and mode) | thinking: little / thorough |
| Allow / Deny | answer a permission request (Claude Code's words); keys A / D | approve, reject |
| Approve / Reject | answer a plan ("Plan to approve") | |
| Decline | not answer a question Claude asked | |
| Ask first / Accept edits / Auto / Plan mode | permission modes; "Default" when the island's default applies | |
| Run now | start an agent by hand ("Started by hand.") | execute |
| Trial run / Refresh | a list command tried before pinning / run again | test, reload |
| open / in progress / blocked / done | list item states | |
| working / waiting for you / done / idle / inactive | session states | busy, ready |
| Tidy island | close the gaps in an island's list and fit the island to it; moved elements stay ("Island tidied · Undo") | rearrange, auto-layout, clean up |
| Squash and merge / Create a merge commit / Rebase and merge | merge methods (GitHub's words) | |
| Fix and merge / Fix only | hand a PR problem to its session | |
| Changes requested / Approved / CI passing / CI running | PR states (GitHub's words) | |
| Session defaults | model, effort and mode per island | settings |
| Keyboard shortcuts | the `?` overview | hotkeys |

## Formats

- Times relative: "now", "12 min ago", "3 h ago", "2 days ago".
- Absolute dates and times through the browser's locale (`toLocaleString(undefined, …)`), so the user sees their own format.
- Quotes with typographic marks: “…”.
- Shortened titles end with "…"; so do buttons that open a dialog or ask for confirmation ("Take over …", "Delete …").

## Keys

- In the board's own text (shortcut overview, menus, hints) a key is always a `<kbd>` through `kbd()` in `util.js`, one look everywhere: "<kbd>W</kbd> jumps", never a bare "W". Each key its own box; a combination is one key (⌘Z, ⌘⇧⌫); alternatives with " / " (<kbd>W</kbd> / <kbd>Q</kbd>).
- Names: Enter, Esc, Space, Delete, F2, arrows as ← ↑ → ↓, modifiers as symbols ⌘ ⇧ ⌥. Letters upper case.
- In a menu the key stands right-aligned beside its entry ("New session … <kbd>N</kbd>").
- Native tooltips (`title`) cannot show boxes: there the key follows in parentheses, same names — "Close (Esc)", "Full width (⌘⇧F)". Written only through `tip()` from `key-table.js`, never by hand (a unit test checks).
- **A key is named only where it works.** A single letter is a board key: it shows on the board (bubble, menu), never in the panel, where the focus usually sits in a field. The shortcut overview groups the keys by where they work (ADR-0043).
- Pointer moves (click, double-click) are words, never boxes.
