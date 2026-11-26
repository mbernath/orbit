# Canvas

## Coordinates

- Positions of elements and frames are **world coordinates**. The camera maps them to the screen with a scale `s` and an offset.
- **Text and glyphs keep their screen size** at every zoom down to the far level (like labels on a map). Only distances scale.
- **Below the far level** dots, names and island heads shrink with the zoom (`g = k / k_far`, ADR-0033); bubbles keep their size. Below `g = 0.5` the **atlas level** takes over: islands summarise instead of shrinking (see [Atlas level](#atlas-level-adr-0037)). ✓ Two dots that do not overlap at the far level do not overlap at any smaller zoom.
- Consequence: text never influences geometry (ADR-0012). ✓ Changing the zoom never changes any frame or element position.

## Islands (frames)

- One frame per workspace: a rounded rectangle in a slightly tinted ground, its name at the top left, a `+` beside the name when the island is active, a resize corner at the bottom right that shows on hover.
- **Size changes only through the user:** drag the corner; or drop an element beyond the edge, then the frame grows once to contain it. ✓ Zoom, hover, events never change a frame.
- **Frames never overlap** (gap 28 world px). A move, resize or growth that would overlap stops at the last valid position; a drop that cannot grow the frame keeps the element inside. ✓ No two frames overlap after any user action.
- **Active island:** the island holding the element being worked with (reply, open, focus, hover), else the island clicked into on free space, else the island under the pointer. It is drawn slightly darker; its name is full ink and shows `+`.
- Inner padding: slots stay ≥ 24 world px from the frame sides and bottom and ≥ 44 from the top (room for the island name), see *Auto-layout*.

## Zoom levels and depth

Three zoom levels (thresholds on `s`; the exact values follow the canvas size):

| Level | Base depth | Typical use |
|---|---|---|
| atlas (`g < 0.5`) | −1 | where am I needed, where is something alive — islands summarise, no single elements (ADR-0037) |
| far | 0 | overview of all islands |
| middle | 1 | working view of one or two islands |
| near | 2 | reading one area |

An element's **depth** = base depth + 1 if it has attention from the user (hovered, keyboard focus, open in the panel), capped at 3. Replying puts it into reply mode (`r`).

What each depth shows is defined per element in [elements.md](elements.md).

## Attention

Two different things, kept apart:

- **Needs the user** (orange, minimap, edge hints): session waiting or done-and-unseen, PR with red CI or mergeable, agent waiting. Not when "Snooze" is set, not while a PR is being fixed by its session.
- **The user's attention** (raises depth, wins placement conflicts): reply > hovered > focused / open > fresh event (≤ 10 s, also shown by a short ripple around the dot) > none.

✓ "Snooze" removes an element from *needs the user*; a new message from it adds it back.

## Auto-layout (ADR-0012, amendment 2026-11-26)

Where dots go when the user has not placed them. Pure (`layoutIslands` in `web/js/island-layout.js`); placement below runs afterwards and never moves geometry.

- **Slot per glyph** (session, agent, file, list — the view's `slot()`): 200×40 world px, the dot at (12, 20) in it, the name beside it. Row pitch 48. Inner padding 24, top 44 (room for the island name). Bubbles get no slot room.
- **List:** left-aligned, one below the other. After 10 a new column starts to the right: column 2 holds items 11–20, and so on. Column pitch 224 (slot width + 24).
- **Frame:** an island without a stored frame is fitted to its highest slot in use (min 220×160); for 1–10 sessions it is 248 wide. A stored frame fills the rows and columns that fit inside it first, then grows where no other frame is touched (both ways, else down, else right). If it cannot grow down, it **wraps**: further slots go into new columns of the frame's own height, and the frame grows right; if the right is blocked too, those columns lie beyond its right edge until the user tidies or resizes. Only a frame lower than one slot still overflows down.
- **Order:** the view's rank, then creation order (`data.startedAt`, then ref). Never activity or state: a session that goes inactive keeps its slot.
- **Stable slots:** a new dot takes the lowest free slot; a removed one leaves a hole, filled by the next new one; a dot that comes back gets its old slot if it is still free. The slot memory is per browser (`orbit.slots`); without it the list closes up in creation order. Stored positions and stored frames win.
- **Tidy island** (island panel, "Island tidied · Undo"): the island's unmoved dots close up in creation order and a stored frame is fitted to its content (never into another frame). Moved elements stay. The only way auto slots close holes.
- **One-time tidy on update:** once per browser (like the slot memory), the first board with elements gives every island whose elements were never moved by hand (no stored element position) a "Tidy island" of its slots — no frame change, nothing written to the server. Islands with a stored element position stay untouched and show the hint "Tidy island: click the name" at their name once (see onboarding.md).
- ✓ One-time tidy: an island without a stored element position closes its slot holes, an island with one keeps its slots and gets the hint; running it again changes nothing.
- ✓ Area per session (frame area / n) ≤ 16,000 world px² for n = 4.
- ✓ For n = 1..30: no two slots overlap, and every slot lies inside its frame.
- ✓ Adding or removing one item leaves every other item's position unchanged.
- ✓ Changing `updatedAt` of any item changes no position.
- ✓ Running the layout twice gives the same result (idempotent).
- ✓ Frames never overlap.
- ✓ In a 12-dot island with 3 waiting sessions, every prio-3 bubble gets placed (it may overlay names and the border, see Placement).
- ✓ A stored frame blocked below wraps 7 slots into columns of 3, 3, 1 and grows right; blocked below and right it keeps its size and no slot lies below it.
- **Moving an island** stores the new frame and the positions of its moved-by-hand elements only; auto-placed dots follow through their slots. A stored element position therefore only ever comes from dragging that element. ✓ After an island is dragged, its auto dots have no stored position and sit in the same slots relative to the frame.

## Placement

Every layout pass places, per element, a **name** (beside the dot, east or west) and a **bubble** (above or below, one of four corners). It never moves dots or frames.

Order of placement (earlier wins conflicts):

1. Elements with the user's attention ≥ hover (their bubble and name).
2. Edge hints (they slide along their edge to a free spot, see below).
3. Everything else, by priority: needs the user > working > documents/memory > resting; ties by id.

**Bubbles**
- Must lie fully inside their frame (exceptions: beside the name, questions, the hovered one — below), keep 14 px from other bubbles, names, dots, link lines and fixed chrome (minimap, zoom dots, listening pill, edge hints).
- Try the current corner first, then the others. If none fits, the element drops one depth level and tries again; at depth 0 there is no bubble.
- **Only a question may cover.** Every bubble except a waiting question (below) and the one under the pointer never covers another element's name or dot — also not the room a name placed after it will take (east of its dot). Without a free spot it drops to its one-line form; if even that does not fit, it shows only on hover.
- **Questions are not hidden for lack of room:** a session waiting for the user's answer (view `asks`: permission or question) that finds no free corner at any depth shows its smallest bubble anyway, at the corner that covers the fewest names. It may cover names and dots of its own island and cross its border; it never covers another bubble, an island name, another island, chrome or the screen edge (then it stays hidden, as before). Names placed after it give way. Done-unseen sessions (also prio 3) do not overlay. (A later overlay step may add dimming of what it covers.)
- ✓ In a crowded island (12 dots) a done bubble never touches another dot, name or name lane; hovered, it shows.
- **Beside the name, to the right (corner `e`):** a bubble other than a question that finds no free corner inside its island may sit beside its own name, level with its dot, and reach past the island's **right** border onto free canvas. It stays within the island's height and covers no other dot or name lane (if a longer name of a neighbour is in its way it starts past that name), no island name, no other island and no chrome. Tried after the corners, at each depth before dropping one. Questions keep their own rule. ✓ In a 10-dot single-column island with free canvas to its right, done bubbles (every other row) show at the default depth beside their names without covering any other name or dot; with another island directly to its right they stay inside as before.
- **Exception:** the element under the pointer (hovered, replying) keeps its bubble as an overlay that may cross its frame. Its corner is **locked** for the whole interaction: chosen once when attention arrives (the already visible corner if any) and never changed while hovering, clicking or typing. Only if it would leave the screen: first shorten the conversation inside the bubble (it scrolls), then flip vertically, then horizontally.
- Focused or open in the panel (no pointer on it): one depth level up like a fresh event, but the bubble gives way like any other — it never covers other elements. Clicking free space ends the focus; Esc and × keep it for the keyboard (Enter, F2, W/Q).
- Hover, depth-2/3 and reply bubbles share one width, so starting to reply never widens a bubble.
- ✓ Hover a session, click into its bubble: corner unchanged, anchored edge moves ≤ 4 px, camera unchanged.

**Names**
- Every element tries to show its name, at every zoom level.
- A name may be shortened with "…" to the room left inside the frame; it is hidden only below 70 px (or its full width if shorter).
- Keeps 4 px from other names, bubbles, dots; may cross link lines (names carry a halo in island colour).
- Changes side only when the other side is free and this one is not, or the other side shows ≥ 24 px more of it.
- ✓ An element with ≥ 120 px room beside it in its frame, away from edge hints, shows its name at every zoom level.

**Stability**
- The layout is a pure function of: positions, frames, camera, attention, sticky choices (last name side, last bubble corner, locked corner). It runs when one of them changes, not on a timer.
- Hidden bubbles fade out with their old content; the depth change is applied after the fade.
- ✓ Running the layout twice in a row changes nothing (at every zoom level and several camera positions).
- ✓ No name and no non-overlay bubble leaves its frame; none lies under fixed chrome.

## Atlas level (ADR-0037)

Like an atlas at continent scale: region names structure quietly, only the places that need the user are marked. Frames and positions stay unchanged; crossing the threshold cross-fades. Per island:

- **Island** keeps the ground and shape of the other levels: no border, no tint.
- **Name** like a region name: 12 px for every island, spaced capitals, muted, top left. Never covers a place (moves to the first free spot, row by row from the top left); two lines at the most balanced word break; never shortened — no room → no name, shown on hover.
- **Places:** each element that needs the user as an orange glyph at its real position — filled when waiting, ring when done. No label.
- **Dormant** (no activity for 7 days, nothing working or waiting): faded.
- Nothing else: no working or resting elements, no counts, no text.
- Click island → middle level, show island. Click a place → go to that element.

✓ A place sits exactly where its glyph is on the other levels. ✓ Working and resting elements have no place. ✓ All island names the same size, inside their frame, never shortened, never over a place. ✓ Island ground equals its frame, no border. ✓ Clicking an island changes no frame or position.

## Edge hints and minimap (ADR-0013)

- **Edge hint:** for each element that needs the user and lies outside the visible area (and is not the open one): a small pill at the board edge in its direction — arrow, island name, shortened title, reason (`wartet`, `fertig`, `CI rot`, `mergebar`). Pointer down or Enter navigates to it.
- Hints slide along their edge, alternating away from the ideal spot, to the nearest place free of other hints, the minimap, the element the user works with, and all dots. No free place → the hint is dropped. ✓ No hint covers a dot or the reply bubble.
- **Minimap** (bottom left of the visible board): the atlas summary at small size (ADR-0037) — frames, the places that need the user as orange dots at their real position, dormant fade; no names in the picture (name on hover). The view is a cut-out: outside it is slightly darkened. Hidden at the atlas level and whenever the whole canvas fits into the view. ✓ Minimap hidden when everything is visible. Press and drag the rectangle to move the view; a press elsewhere centres there and the drag continues. When the bubble the user works with needs its corner, the minimap tucks into a small tile; clicking it ends that interaction and unfolds it.
- All board chrome (minimap, zoom dots, `?`, status line, listening pill, edge hints) lives in the **visible** board: it moves left when the detail panel opens. ✓ The zoom dots never overlap the detail panel.

## Camera (ADR-0012)

- **Zoom changes only through explicit zoom input:** pinch, ⌘/Ctrl + wheel, `+` / `−`, the zoom dots, `G` + letter (show island).
- **First start:** fits everything, but never below the far level; if it does not fit, it shows the top left (ADR-0033). ✓ A fresh start never has `k < k_far`.
- **Pan:** two-finger swipe / wheel, drag on free space, arrow keys, minimap drag.
- **Automatic pan only when needed:** when an element the user acts on would otherwise be out of sight (keyboard focus, edge hint, `W`/`Q`, voice routing, new element placed out of view, reply bubble that cannot fit even after shortening and flipping) — and only as far as needed, never re-centring, never at another zoom.
- **Never moves:** hover, selection, replying, opening or closing the detail panel, window resize, `+` in a visible island, Esc.
- ✓ Opening and closing the panel leaves the camera unchanged; `+` in a visible island, replying and Esc leave it unchanged; edge-hint navigation keeps the zoom.

## Links

Drawn as hairlines between sessions (solid "hands over to", dashed "waits for", dotted "same topic"; direction arrow at the middle). A pulse runs along a link when a message passes. **What links do technically is open** and will be specified with concrete cases.
