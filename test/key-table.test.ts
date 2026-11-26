// ADR-0043: one table of keys; a tooltip names a key only where it works, and no tooltip names one by hand.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS, KEYS, tip } from "../web/js/key-table.js";

const WEB = join(import.meta.dir, "..", "web", "js");
/** every board module, without the vendored ones */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(join(dir, d.name)) : d.name.endsWith(".js") ? [readFileSync(join(dir, d.name), "utf8")] : [],
  );

test("tip: a board key shows on the board but not in the panel; ⌘⇧ keys show everywhere", () => {
  expect(tip("Remove", "remove", "board")).toBe("Remove (Delete)");
  expect(tip("Remove", "remove", "panel")).toBe("Remove");
  expect(tip("Snooze", "snooze", "panel")).toBe("Snooze (⌘⇧S)");
  expect(tip("Snooze", "snooze", "board")).toBe("Snooze (⌘⇧S)");
  expect(tip("Attach", "paste", "field")).toBe("Attach (⌘V)");
  expect(tip("Attach", "paste", "panel")).toBe("Attach");
  expect(() => tip("x", "no-such-key", "board")).toThrow();
});

test("the table: unique ids, every entry in a group of the overview", () => {
  const ids = KEYS.map((k) => k.id);
  expect(new Set(ids).size).toBe(ids.length);
  const groups = GROUPS.map(([w]) => w);
  for (const k of KEYS) expect(groups).toContain(k.where);
});

test("S alone is no key any more: Snooze / Seen is ⌘⇧S, in both places", () => {
  expect(KEYS.find((k) => k.keys === "S")).toBeUndefined();
  expect(KEYS.find((k) => k.id === "snooze")).toMatchObject({ keys: "⌘⇧S", where: "anywhere" });
});

test("every tip() names a key of the table, and no tooltip writes a key by hand", () => {
  const all = sources(WEB).join("\n");
  const used = [...all.matchAll(/tip\([^;]*?,\s*"([a-z-]+)",\s*"(board|panel|field)"\)/g)].map((m) => m[1] ?? "");
  expect(used.length).toBeGreaterThan(5);
  for (const id of used) expect(KEYS.map((k) => k.id)).toContain(id);
  // a literal "(Esc)", "(⌘⇧F)", "(S)" in a title would bypass the table
  expect(all.match(/title="[^"$]*\((⌘|⇧|Esc|Enter|Space|Delete|F2|[A-Z])[^)]*\)"/g)).toBeNull();
});
