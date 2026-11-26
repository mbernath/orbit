// @ts-check
// Stage 1b of the first run (docs/design/onboarding.md, ADR-0041 amendment): an island made from a suggestion keeps
// only its recent sessions on the board — the last 7 days, at most 12 — and says so in one quiet line at the island:
// "Keep" just closes it, "Show all" brings the older ones back, "Show none" removes the recent ones too —
// the last two through canvas.archive, with Undo. The line goes after a choice or the first other board interaction; it is never stored.
import { runAction } from "./api.js";
import { store } from "./store.js";
import { offerUndo } from "./undo.js";
import { $ } from "./util.js";

export const RECENT_MS = 7 * 86_400_000;
export const KEEP_MAX = 12;

/** @typedef {import("./store.js").Entity} Entity */

/** Split an island's sessions into the ones that stay and the ones kept off, most recent first.
 * @param {Entity[]} sessions @param {number} now @returns {{ recent: string[], older: string[] }} */
export function splitRecent(sessions, now) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = sorted.filter((e) => e.updatedAt >= now - RECENT_MS).slice(0, KEEP_MAX).map((e) => e.ref);
  const keep = new Set(recent);
  return { recent, older: sorted.filter((e) => !keep.has(e.ref)).map((e) => e.ref) };
}

/** the line on screen: its island and the two groups @type {{ island: string, recent: string[], older: string[] } | null} */
let line = null;
let refresh = async () => {};

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n} ${n === 1 ? one : many}`;

function text() {
  if (!line) return "";
  const r = line.recent.length, o = line.older.length;
  const head = r ? plural(r, "recent session", "recent sessions") : "No recent sessions";
  return `<span>${head} · ${plural(o, "older one", "older ones")} kept off the board — </span><button data-import="keep" class="keep">Keep</button><span> · </span><button data-import="all">Show all</button>${r ? `<span> · </span><button data-import="none">Show none</button>` : ""}`;
}

function close() {
  line = null;
  $("import-line").hidden = true;
  document.removeEventListener("pointerdown", other, true);
  document.removeEventListener("keydown", other, true);
  document.removeEventListener("wheel", other, true);
}
/** the first other interaction with the board ends the offer @param {Event} ev */
function other(ev) {
  if (ev.target instanceof Node && $("import-line").contains(ev.target)) return;
  close();
  void refresh(); // a hint may be due now
}

/** @param {string[]} refs @param {boolean} archived */
const archive = async (refs, archived) => (await runAction("canvas.archive", { refs, archived }), refresh());

/** @param {"keep" | "all" | "none"} what */
async function choose(what) {
  if (!line) return;
  const { recent, older } = line;
  close();
  if (what === "keep") return; // the default is fine: the line just goes, the first hint follows (hints.js)
  if (what === "all") {
    await archive(older, false);
    offerUndo({ text: `${plural(older.length, "older session", "older sessions")} back on the board`, undo: () => archive(older, true) });
  } else {
    await archive(recent, true);
    offerUndo({ text: `${recent.length} removed from board`, undo: () => archive(recent, false) });
  }
}

/** Wire once. @param {{ refresh: () => Promise<unknown> }} c */
export function installImportChoice(c) {
  refresh = async () => void (await c.refresh());
  $("import-line").addEventListener("click", (ev) => {
    const b = /** @type {HTMLElement} */ (ev.target).closest("[data-import]");
    if (b instanceof HTMLElement) void choose(b.dataset.import === "none" ? "none" : b.dataset.import === "keep" ? "keep" : "all");
  });
}

/** Right after an island was made from a suggestion and the board has its imported sessions. @param {string} island */
export async function keepRecent(island) {
  const sessions = store.entities.filter((e) => e.kind === "session" && store.islandOf(e) === island && !store.isArchived(e.ref) && !store.isRun(e));
  const { recent, older } = splitRecent(sessions, Date.now());
  if (!older.length) return;
  await archive(older, true);
  line = { island, recent, older };
  const box = $("import-line");
  box.innerHTML = text();
  box.hidden = false;
  placeImportLine();
  document.addEventListener("pointerdown", other, true);
  document.addEventListener("keydown", other, true);
  document.addEventListener("wheel", other, true);
}

/** Just below the island, outside its sessions and clear of the notices at the top; runs with every board render while the line shows. */
export function placeImportLine() {
  const box = $("import-line");
  if (!line) return;
  const frame = document.querySelector(`[data-frame="${CSS.escape(line.island)}"]`);
  if (!frame) return void (box.style.visibility = "hidden");
  const r = frame.getBoundingClientRect(), v = $("viewport").getBoundingClientRect();
  box.style.visibility = "";
  box.style.left = `${r.left - v.left}px`;
  box.style.top = `${r.bottom - v.top + 10}px`;
}
