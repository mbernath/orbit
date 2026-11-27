# ADR-0045 — Colour codes in rendered text get a swatch

**Status:** Accepted · 2026-11-27 · builds on [ADR-0029](0029-markdown-it-renderer.md), [ADR-0030](0030-open-local-files-from-text.md)

## Context

Claude often names colours as hex codes (design tokens, CSS fixes). In the board they were plain text: to see the colour the user had to copy it somewhere else. VS Code shows a small swatch before every colour code.

## Decision

Like file references (ADR-0030), colour codes are recognised in rendered Markdown and get an inline tool. Board only, no core change.

- **Recognised:** `#rrggbb` and `#rrggbbaa` in text and inline code, not inside links or code blocks. Not after a word character, `&`, `/` or `#`, and not followed by a word character or `-`. **Short forms `#rgb`/`#rgba` are not recognised:** in prose `#123` is almost always an issue or PR number. `web/js/color-ref.js` (pure) recognises and converts; `md-colors.js` is the markdown-it rule.
- **Look:** a swatch the size of the text before the code, which stays as it is. A thin border keeps white and black visible in both themes; a checkerboard shows transparency. The text itself is never coloured.
- **Interaction:** hover shows hex, rgb() and hsl() as a tooltip. A click (or Enter) opens a popover with a large preview and the three formats; a click on one copies it. Escape or a click elsewhere closes it.
- **Read-only.** No colour picker that changes the value: chat and transcripts cannot be changed. A picker for pinned Markdown files, through the save path with hash check (ADR-0011), is possible later as its own decision.

## Consequences

- Wherever Markdown is rendered (conversation, documents, previews), colours are visible and copyable in another format.
- `rgb()`/`hsl()` notation and colours in code blocks are not recognised yet.

## Alternatives

- **Colour the text itself.** Unreadable for light colours on a light theme.
- **Short forms in inline code only.** Rejected for now: simpler rule, fewer surprises.
