# Orbit design specification

This folder describes **how the board looks and behaves** in enough detail to build and test it. The ADRs in [../adr/](../adr/) record *why* something was decided; this specification records *what exactly* the result is. When the two disagree, the ADR wins and this text is fixed.

Every rule that can be checked by a machine carries an acceptance criterion marked **✓**. Those criteria become tests (`bun test` for pure logic, Playwright for interaction, ADR-0018).

| Part | Content |
|---|---|
| [principles.md](principles.md) | The north star and the few rules everything else follows |
| [canvas.md](canvas.md) | Islands, zoom levels, depth, attention, placement of names and bubbles, camera |
| [elements.md](elements.md) | Every kind of element: how it looks in each state, what it shows at each depth, which actions it offers (CRUD matrix) |
| [interaction.md](interaction.md) | Pointer, keyboard, detail panel, menus, undo |
| [copy.md](copy.md) | Language and wording of everything the user reads |
| [gap-analysis.md](gap-analysis.md) | Board today vs. this specification, and the order of the work |

**Reference, not template:** [prototype.html](prototype.html) is the interactive design prototype these rules were found with (22 iterations, November 2026). It is a single file with sample data and simulated sessions. Use it to see and try the intended behaviour; do not copy its code. Open it in a browser; append `?check` to the URL to run its built-in layout self-check (result in `<html data-check>` and the console).

**Open topics** (deliberately undecided): what links between sessions do technically (they are drawn only), and voice input (Spokenly vs. Parakeet in Orbit). Both are listed where they touch the specification.
