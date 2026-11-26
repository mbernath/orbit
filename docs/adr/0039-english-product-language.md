# ADR-0039 — The product speaks English too

**Status:** Accepted · 2026-11-24 · supersedes [ADR-0001](0001-repository-language.md) in its German-UI part

## Context

Orbit is going to be shared with other developers through GitHub. ADR-0001 kept the board German because its only user read German. With more than one user, a German-only board is a barrier, and the deciding rule of ADR-0001 ("developer reads it → English, end user reads it → German") no longer separates two audiences.

## Decision

**Everything is English: repository and product.** Board labels, hints, notifications, API error messages and text Orbit sends to Claude on the user's behalf are English.

- No i18n layer. Strings stay inline in the views and sources, as today; one language means no catalogue, no keys, no build step.
- The conversation with an assistant still follows the user's language; artefacts are English regardless.

## Consequences

- One rule for every string, easy to check by eye.
- The translation is a single dedicated step (copy in `web/`, user-facing messages in `src/`, the design copy spec in `docs/design/`, test assertions on strings).
- Adding a second language later would mean introducing i18n then — a new ADR.

## Alternatives

- **Keep German.** No work, but excludes users who don't read German.
- **i18n with German and English.** Serves both, but adds a string catalogue and indirection to every view for an audience that reads English anyway.
