# ADR-0001 — The repository is English, the product speaks German

**Status:** Accepted · 2026-11-20 · UI language superseded by [ADR-0039](0039-english-product-language.md)

## Context

Orbit started with German docs (README, CLAUDE.md) and English code. The owner works in German, and the board's users read German. Agents mirror the language of their instructions into what they write, so mixed docs keep producing mixed artefacts. A sister project of the owner settled the same question the same way.

## Decision

**Everything a developer reads is English. Everything the end user reads in the board is German.**

- English: code, comments, identifiers, README, CLAUDE.md, ADRs, commit messages, log and console output.
- German: board labels, hints, notifications, and API error messages the board displays to the user.
- The conversation with the user is German. The language of a request does not decide the language of the artefact.

## Consequences

- One rule for every file, easy to check by eye.
- Docs are readable for anyone who might contribute later and match the sister project.
- Switching the UI language later would be a product decision, not a translation.

## Alternatives

- **Everything German.** Consistent with the conversation, but code would mix languages and breaks with the sister project's convention.
- **Docs German, code English (the previous state).** The seam runs through the files agents read first.
