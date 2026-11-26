# Principles

## North star

> Orbit is a calm table on which your sessions lie. It speaks only when something needs you, and tells you more when you look closer.

Three references shaped it:

- **Calm technology** (Weiser, Case): information lives at the edge of attention and moves to the centre only when it needs you.
- **Tufte, data-ink:** every mark carries information; no decoration, no chart junk, no legends that explain the obvious.
- **Bret Victor, explorable explanations:** understanding comes from touching. Details appear on hover, focus and zoom, not as permanent labels.

## Rules

1. **The board is the user's own order.** Elements stay where they put them. Nothing rearranges itself; no automatic layout moves an element he has placed. (ADR-0008, ADR-0012)
2. **One canvas, projects as islands.** All workspaces share one canvas; each is an island (a frame). Orientation comes from the minimap and edge hints, not from separate views. (ADR-0012, ADR-0013)
3. **Attention is the only loud thing.** One signal colour (orange) marks what needs the user: waiting, done, CI red, mergeable. Everything else is greyscale on a warm ground. "Snooze" lets the user silence a session until it says something new.
4. **No legends, no field labels.** State is shape and fill; meaning is discovered by looking, hovering and zooming. Explanations live in the shortcut overview (`?`), not on the board.
5. **Depth by zoom, more depth by attention.** The zoom level sets how much every element shows; the element the user is looking at shows one level more. (ADR-0012)
6. **Names like on a map.** Every element tries to show its name; in a conflict the more important one wins; names may be shortened, never overlap.
7. **The view belongs to the user.** The camera moves only when they move it, or when something they act on would otherwise be out of sight — and then as little as possible, never with a different zoom. (ADR-0012)
8. **What a bubble can do, the detail panel can do.** Every action is available in both places, and by keyboard.
9. **Honest about control.** The board never offers what it cannot do: observed sessions are read-only until taken over; cloud agents have no model to choose. (ADR-0010)
10. **Nothing is lost silently.** Removing is always reversible (undo, archive list); destructive or outward actions (merge, island removal) ask once, in place.
11. **Calm motion.** Things fade in and out (~0.25 s in, ~0.5 s out); nothing jumps, nothing moves by itself except the camera on explicit navigation. `prefers-reduced-motion` turns animation off.
12. **Done means checked.** Each rule in this specification has an acceptance criterion; a change is done when its tests are green and a real browser screenshot looks right.
