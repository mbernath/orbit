# ADR-0012 — Islands are fixed frames; text placement never changes geometry; layout is a pure function

**Status:** Accepted · 2026-11-22 · refines [ADR-0008](0008-canvas-model.md)

## Context

All workspaces share one canvas; each workspace is an island. In the design prototype the island was the hull around its content *including the visible labels*. Labels have a constant screen size while positions live in world coordinates, so a label's world width is `px / zoom`: islands grew when zooming out and overlapped at some zoom levels. The layout also ran on a timer and read its own previous output (island name position → label side → hull → island name position), which made labels flip sides every few hundred milliseconds. Patching single cases would not end this class of bugs.

## Decision

- **Islands are frames.** A frame is an element with `x, y, w, h` in world coordinates (ADR-0008 `parent`/`w`/`h`). Its geometry changes only through a user action: dragging its name moves it with its content, dragging its corner resizes it, dropping an element beyond its edge grows it once to contain the element. Zoom, hover and incoming events never change geometry.
- **Frames never overlap.** Checked at edit time: a move, resize or growth that would overlap another frame (plus a gap) is limited to the last valid position. An element cannot be dropped outside its own frame if the frame cannot grow there; it stays inside.
- **Text is placed afterwards and only decides visibility.** A separate pass chooses, per element, whether to show its label and speech bubble, on which side, and at which depth. Its inputs are element positions, frames, camera, attention and fixed screen chrome (minimap, edge hints, listening indicator). Its output never feeds back into geometry. The frame border is a hard limit: a label is truncated to the space left or hidden, a bubble that does not fit drops a depth level. The one exception is the element you are working with (hovered, focused, open or replying): its bubble is an overlay and may cross the border.
- **Layout is a pure function** of (elements, frames, camera, attention, sticky choices). It runs when one of those changes, not on a timer. The only state it carries over is explicit stickiness (last label side, last bubble corner), so an element you look at does not move.
- **Camera.** The view is the user's; the board moves it as little as possible.
  - Zoom changes only through explicit zoom input: pinch, ⌘/Ctrl + wheel, `+`/`−`, the zoom dots, and "show island". Esc and double-click never zoom.
  - The view pans only when an element the user acts on would otherwise be out of sight (keyboard focus, navigation via edge hint, `W` or voice, a new session placed outside the view, a reply bubble that cannot fit even after shortening its history), and only as far as needed — never re-centring, never at a different zoom.
  - Hover, selection, replying, opening or closing the sidebar and resizing the window never move the view.
- **Machine-checked properties** (prototype self-check now, unit tests in the board later): running the layout twice in a row changes nothing; no two frames overlap; no label or non-overlay bubble leaves its frame — at every zoom level.

## Consequences

- No zoom-dependent overlaps and no oscillation by construction, and both are testable.
- Frames need size management by the user (resize grip, growth on drop). When zoomed far out, text may not fit any more; then only dots, island names and edge hints remain — by design.
- Implementing this in the board resolves architecture debt #3 (lanes as frames) and #5 (element sizes).

## Alternatives

- **Hull around content and labels.** Grows and shrinks with zoom; caused the overlaps and the feedback loop.
- **Text scaled with the world inside each zoom level (map-style).** Deterministic per level, but text size changes while zooming and jumps between levels — too restless for a working tool.
- **No island areas, grouping by proximity only.** Nothing can overlap, but loses the visible boundary that answers "where am I".

## Amendment 2026-11-24 — a drop holds the glyph, not the bubble room

A dot's element box (280×160) is mostly room reserved for its bubble; the glyph sits at the view's `anchor`. Holding the whole box inside the frame on drop kept dots ~260 world units away from the right edge and ~80 from top and bottom, and where the frame could not grow the dot jumped back. Now a drop holds only a square of ±`HOLD` around the anchor inside the frame (`holdOf` in `web/js/frames.js`); growth on drop is sized to that square too. Views without an anchor still hold their whole box. The bubble needs no room reserved at drop time: placement already slides it, flips its corner or drops a depth level at the frame border (decision above). Auto-placement keeps spacing whole boxes.

## Amendment 2026-11-24 — only the pointer makes a bubble an overlay

A clicked element kept its focus after the panel closed (only a second Esc cleared it), so its enlarged bubble stayed on top of other elements with no visible reason. Now clicking free space ends the focus (Esc and × keep it, the keyboard still works on that element), and the overlay exception above applies only to the element under the pointer (hover, reply). Focus and an open panel still raise the depth by one, but the bubble is placed like a fresh event's: inside its frame, giving way or dropping a depth level. The panel already shows the whole conversation, so nothing is lost.

## Amendment 2026-11-26 — slots, not bubbles; a stable list; Tidy island

A 12-session island took far too much room: auto-placement spaced each dot's whole 280×160 box, which is mostly room reserved for a bubble that is rarely shown. And unplaced elements were sorted newest `updatedAt` first, so every bit of activity reordered the dots — against the stability this ADR promises.

- **The layout spaces slots, not bubbles.** An auto-placed session gets a slot for its dot and name (about 200×40). Bubbles never affect geometry; placement fits them afterwards as before.
- **Stable creation order.** Auto order is rank, then when the entity began (`data.startedAt` for sessions), then ref — never activity. Changing `updatedAt` changes no position.
- **A left-aligned list, a new column every 10.** Sessions sit one below the other; from the 11th on a new column starts to the right (newspaper style: column 2 holds 11–20, …).
- **Auto-placed dots never move** when others are added, removed or change state: a new one takes the next free slot, a removed one leaves a hole that the next new one fills. Stored positions and stored frames keep winning.
- **Waiting questions may overlay.** A prio-3 bubble (needs the user) may cover other names, which dim or yield, and may extend past the island border. This resolves debt #24 once the overlay step lands.
- **Tidy island** in the island menu is the only way the auto layout repacks: an explicit, undoable geometry action that repacks the unmoved dots and fits the frame.

- **Slot memory per browser (implementation).** The layout takes the slots of its last run and returns the new ones (`layoutIslands(…, prev)`), so it stays a pure function. The board keeps them in `localStorage`. They are not written into the element geometry: that would turn an auto dot into a moved one, which then wins over the list and cannot be tidied, and every new session would cost an action and an `events` row. Trade-off in [debt #48](../architecture-debt.md).
- **Rank comes from the view only**, never from state (formerly inactive sessions sorted last and moved when they woke).
- **Only questions cover; one-time tidy (later the same day).** Only a waiting question (`asks`) may overlay names and dots of its own island and cross its border; every other bubble keeps clear of all dots and name lanes, else gets smaller, else shows on hover (resolves debt #24). Once per browser, islands without a stored element position get Tidy island (slots only); islands with one stay and show a one-time hint at their "+". "Moved by hand" means a stored element x/y — which moving a whole island also writes for all its dots.
- **Moving an island no longer stores its auto dots (later the same day).** A frame drag sends moves only for elements that already have a stored position; auto dots follow through their slots. So a stored element position only ever comes from dragging that element, and "moved by hand" means exactly that.
- **Non-question bubbles may reach right onto free canvas.** Without a free corner inside the island, a bubble other than a question may sit beside its own name (corner `e`, level with the dot) and extend past the island's right border — never over another dot, name lane, island name, other island or chrome, and within the island's height. In the list layout a done session's answer shows again in the common case.
- **A stored frame blocked below wraps.** Slots that do not fit go into new columns of the frame's height and the frame grows right; blocked right too, the columns lie beyond its edge until tidy or resize. Only a frame lower than one slot overflows down.

Numbers and acceptance criteria: [docs/design/canvas.md](../design/canvas.md), *Auto-layout*.
