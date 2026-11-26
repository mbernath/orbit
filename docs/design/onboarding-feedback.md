# Onboarding feedback

Notes while trying the first run (`bun run fresh`). One line per observation; the agent works through them and moves done ones to the bottom.

## Open

- Das erste Layout der existierenden Sessions mit zwei Spalten hat große Abstände. Dadurch wird die Insel sehr groß. Das perfekte Auto Layout ist nicht nur eine Onboarding Sache.
  → Own task (layout design first). Waiting for the decision.

## Done

- The no-hook line overlaps the top of a freshly fitted island (seen in onboarding-import-line.png): the camera fit ignores the notice.
  → Fitting the view leaves room below visible top notices (`data-inset="top"`); the fitted island starts under the line.
- Man erkennt nicht genau, wozu die magentafarbenen Onboarding-Bubbles gehören, und übersieht sie leicht.
  → Hints are anchored callouts: 12.5px pill with a notch toward the target, a guide ring around the dot, "+" or zoom dots that pulses three times then stays; never over another session's name.
- Nach der ersten Insel steht die Zeile zum Rückgängigmachen der Übernahme da. Wenn ich damit ok bin, geht es nicht einfach so weiter.
  → The line offers "Keep" first (with a pointer up to the island); once it closes in any way, the "open" hint appears at once.

- Viele längst geschlossene Sessions tauchen auf.
  → Suggestions show "42 sessions, 9 this week"; the new island keeps the last 7 days (max 12), the line "… older ones kept off the board — Show all · Show none" offers the rest, undoable (ADR-0041 amendment).
- Hinweise ließen sich nicht testen (keine aktiven Sessions).
  → `bun run fresh` prints the URL with `?hints=reset`; `bun run fresh --demo` simulates live sessions (working, waiting, done) in the most recent folder.

- Die Hinweise wo man etwas machen kann, sieht man nicht wirklich. … Signalfarbe, keine existierende.
  → Own colour `--guide` (magenta), reserved for onboarding; hints are pills with a dot that fade in once.
- Ganz zum Start bei der Auswahl eines Folders sind die Zoomstufen unten rechts sichtbar und auch aktiv.
  → Zoom dots, minimap and edge hints hidden on the first-run screen; zoom keys and wheel zoom off.
- „Take over“ dorthin, wo man eigentlich schreiben will, mit Erklärung.
  → Observed sessions show "Runs outside Orbit — take it over to reply here." with "Take over …" in the reply field's place.
