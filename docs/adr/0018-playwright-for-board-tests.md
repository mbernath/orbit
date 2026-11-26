# ADR-0018 — Playwright as a dev dependency for board interaction tests

**Status:** Accepted · 2026-11-22 · resolves architecture debt #6

## Context

The board's behaviour is specified with machine-checkable criteria ([../design/](../design/)). Pure layout and camera rules can be unit-tested with `bun test` once they live in DOM-free modules. Interaction — pointer, keyboard, focus, the detail panel, menus — and the real rendering (text widths, fonts, CSS) can only be checked in a browser. So far this was done by hand and by screenshot (debt #6). During the design prototype, a headless-Chrome self-check found more than ten real defects that hand testing had missed.

## Decision

- Add **Playwright** (`@playwright/test`) as a **dev dependency** only; it is never loaded by the server or the board.
- Tests live in `test/e2e/`, start the server against a temporary data directory with fixture sessions (never `~/.claude`), and run the board in Chromium.
- They cover the interaction criteria of the design specification (reply without camera movement, panel open/close, Esc, edge-hint navigation, minimap drag, keyboard map) and take reference screenshots at a few window sizes.
- `bun test` stays the fast default; the browser suite runs with its own script (`bun run test:e2e`) and before every commit that touches `web/`.

## Consequences

- Interaction rules become regression-tested; "done" for UI work is checkable.
- One more dependency and a Chromium download for development; nothing changes for running Orbit.

## Alternatives

- **Screenshots and manual checks only.** Missed many defects in the prototype.
- **A self-check inside the page** (as in the prototype). Useful for exploring, but mixes test code into the product and must be kept out of normal runs.
- **Puppeteer.** Similar; Playwright's test runner, auto-waiting and multi-browser support fit better.
