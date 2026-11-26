// @ts-check
// Stage 3 of the first run (docs/design/onboarding.md, ADR-0041): one small hint at a time, at the moment it is
// needed, gone for good once its action happened — also when the action came before the hint ever showed.
// Progress is per browser (localStorage `orbit.hints`); `?hints=reset` clears it. The actions are observed here
// (panel shown, island menu or overview added to the page, keys pressed), so no other module knows about hints.
import { attention, needsUser } from "./board-layout.js";
import { store } from "./store.js";
import { tidyHintIslands } from "./tidy-once.js";
import { $, kbd, prefs } from "./util.js";

/** @typedef {"tidy" | "open" | "snooze" | "jump" | "island" | "keys"} HintId */
/** @typedef {{ id: HintId, text: string, anchor: () => Element | null, place: "beside" | "above" | "left" }} Hint  text is HTML: keys as <kbd> */

/** @type {Set<string>} */
const done = new Set();
try {
  const url = new URL(location.href);
  if (url.searchParams.get("hints") === "reset") {
    prefs.set("hints", "[]");
    url.searchParams.delete("hints"); // once: a reload must not bring the hints back again
    history.replaceState(null, "", url);
  }
  for (const id of JSON.parse(prefs.get("hints") ?? "[]")) done.add(id);
} catch {}

/** @param {HintId} id */
function retire(id) {
  if (done.has(id)) return;
  done.add(id);
  prefs.set("hints", JSON.stringify([...done]));
  update();
}

const viewport = () => $("viewport");
const panelRect = () => {
  const p = $("panel");
  return p.hidden ? null : p.getBoundingClientRect();
};
/** on screen, inside the board and not behind the open panel @param {Element | null | undefined} el */
function shown(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect(), v = viewport().getBoundingClientRect(), p = panelRect();
  if (!r.width || r.right < v.left || r.left > v.right || r.bottom < v.top || r.top > v.bottom) return false;
  return !(p && r.right > p.left && r.left < p.right);
}
/** a session's name label (the hint goes beside it, never over the bubble), else its dot @param {import("./store.js").Entity} e */
const dotOf = (e) => {
  const el = document.querySelector(`[data-element="${CSS.escape(e.ref)}"]`);
  return el?.querySelector(".lab") ?? el?.querySelector("[data-dot]") ?? null;
};
/** beside a label: after its end, or before its start when the name sits left of its dot @param {DOMRect} r @param {Element} label */
const labelOnLeft = (r, label) => {
  const dot = label.closest("[data-element]")?.querySelector("[data-dot]")?.getBoundingClientRect();
  return !!dot && r.left < dot.left;
};
const onBoard = (/** @type {import("./store.js").Entity} */ e) => !store.isArchived(e.ref) && !store.isRun(e);
/** the first matching entity whose dot is on screen @param {(e: import("./store.js").Entity) => boolean} test */
const firstDot = (test) => store.entities.filter((e) => onBoard(e) && test(e)).map(dotOf).find(shown) ?? null;
/** the island name @param {string} id */
const nameOf = (id) => document.querySelector(`#world [data-frame="${CSS.escape(id)}"] .frame-name`);
const needing = () => store.entities.filter((e) => (e.kind === "session" || e.kind === "agent") && onBoard(e) && needsUser(e));

/** @type {Hint[]} the table of docs/design/onboarding.md, in order */
const HINTS = [
  // after the list layout arrived, at an island that kept hand-moved dots (tidy-once.js, canvas.md "Auto-layout")
  { id: "tidy", text: "Tidy island: click the name", place: "above", anchor: () => tidyHintIslands().map(nameOf).find(shown) ?? null }, // ADR-0042
  { id: "open", text: `${kbd("Enter")} or click opens it`, place: "beside", anchor: () => firstDot((e) => e.kind === "session") },
  { id: "snooze", text: `${kbd("⌘⇧S")} snoozes · ${kbd("Space")} replies`, place: "beside", anchor: () => firstDot((e) => e.kind === "session" && e.attention?.level === "waiting") },
  { id: "jump", text: `${kbd("W")} jumps to the next one that needs you`, place: "beside", anchor: () => (needing().length >= 2 ? needing().map(dotOf).find(shown) ?? null : null) },
  {
    id: "island", text: "Add a session, agent, file or list", place: "above",
    anchor: () => (done.has("open") ? [...document.querySelectorAll("#world .frame-add")].find(shown) ?? null : null),
  },
  {
    id: "keys", text: `${kbd("?")} all keys`, place: "left",
    anchor: () => (["open", "snooze", "jump"].every((id) => done.has(id)) ? document.querySelector("#viewport .chrome") : null),
  },
];

/** a menu, dialog or the overview is open, the board is hidden or shows the atlas: no hint */
const quiet = () =>
  viewport().classList.contains("atlas-on") || document.body.classList.contains("panel-full") || !viewport().offsetWidth ||
  !!document.querySelector("body > .menu, body > .shortcuts, dialog[open], #import-line:not([hidden])");

const PILL_H = 20, GAP = 8; // style.css .hint: the pill's height; the room its notch bridges to the target

/** the element that wears the halo: a session's dot (not its name), else the anchor itself @param {Element} anchor */
const haloOf = (anchor) => (anchor.matches(".lab") ? anchor.closest("[data-element]")?.querySelector("[data-dot]") : null) ?? anchor;
/** @type {Element | null} the target ringed right now */
let ringed = null;
/** Move the halo; `pulse` only when the hint has just appeared. @param {Element | null} el @param {boolean} pulse */
function ring(el, pulse) {
  if (ringed !== el) ringed?.classList.remove("guide-halo", "guide-pulse");
  ringed = el;
  el?.classList.add("guide-halo"); // also on a fresh element after a re-render: the still ring, no pulse again
  if (pulse) el?.classList.add("guide-pulse");
}

/** Place the hint whose moment has come, or none. Runs with every board layout. */
export function update() {
  const box = $("hint");
  let hint = null, anchor = null;
  if (!quiet())
    for (const h of HINTS) {
      if (done.has(h.id)) continue;
      anchor = h.anchor();
      if (anchor) (hint = h);
      if (hint) break;
    }
  if (!hint || !anchor) return void ((box.hidden = true), ring(null, false));
  const fresh = box.dataset.hint !== hint.id || box.hidden;
  if (box.dataset.hint !== hint.id) (box.dataset.hint = hint.id), (box.innerHTML = hint.text);
  box.hidden = false;
  const target = haloOf(anchor), v = viewport().getBoundingClientRect();
  const p = placeFor(hint, anchor, target, box.offsetWidth);
  box.dataset.side = p.side; // where the pill sits, so its notch points back at the target (onboarding.md "Look")
  box.style.left = `${p.x - v.left}px`;
  box.style.top = `${p.y - v.top}px`;
  ring(target, fresh);
}

/** @typedef {{ side: "right" | "left" | "above" | "below", x: number, y: number }} Place screen position of the pill */
/**
 * The first place that covers no other session's name or bubble: beside the name first, else above or below
 * its dot. Zoom dots and the island "+" have one fixed place. @param {Hint} hint @param {Element} anchor
 * @param {Element} target the haloed element @param {number} w the pill's width @returns {Place}
 */
function placeFor(hint, anchor, target, w) {
  const r = anchor.getBoundingClientRect(), d = target.getBoundingClientRect();
  const midY = r.top + r.height / 2 - PILL_H / 2, x0 = d.left + d.width / 2 - 16; // the notch sits 16px in
  if (hint.place === "above") return { side: "above", x: x0, y: r.top - PILL_H - GAP };
  if (hint.place === "left") return { side: "left", x: r.left - GAP - w, y: midY };
  /** @type {Place[]} */
  const places = [
    labelOnLeft(r, anchor) ? { side: "left", x: r.left - GAP - w, y: midY } : { side: "right", x: r.right + GAP, y: midY },
    { side: "above", x: x0, y: d.top - PILL_H - GAP },
    { side: "below", x: x0, y: d.bottom + GAP },
  ];
  const own = anchor.closest("[data-element]");
  const others = [...document.querySelectorAll("#world [data-element] :is(.lab, .bub)")]
    .filter((el) => el.closest("[data-element]") !== own).map((el) => el.getBoundingClientRect()).filter((b) => b.width);
  const free = (/** @type {Place} */ p) => !others.some((b) => p.x < b.right && p.x + w > b.left && p.y < b.bottom && p.y + PILL_H > b.top);
  return places.find(free) ?? /** @type {Place} */ (places[0]);
}

/** text fields keep their keys */
const typing = (/** @type {EventTarget | null} */ t) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

export function installHints() {
  // opening any panel
  new MutationObserver(() => {
    const p = $("panel");
    if (p.hidden) return update();
    // the island panel (ADR-0042) of an island the tidy hint points at is where Tidy island lives
    if (p.dataset.island) return tidyHintIslands().includes(p.dataset.island) ? retire("tidy") : update();
    retire("open");
  }).observe($("panel"), { attributes: true, attributeFilter: ["hidden", "data-island"] });
  // an island menu (its island is marked as target) or the shortcut overview appears; any menu hides hints
  new MutationObserver(() => {
    const target = document.querySelector("body > .menu[role=menu]") && document.querySelector("#world .frame.target");
    if (target) retire("island");
    if (document.querySelector("body > .shortcuts")) retire("keys");
    update();
  }).observe(document.body, { childList: true });
  // the import line (stage 1b) closing in any way lets the first hint follow at once
  new MutationObserver(() => update()).observe($("import-line"), { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("keydown", (ev) => {
    if (ev.code === "KeyS" && (ev.metaKey || ev.ctrlKey) && ev.shiftKey) return retire("snooze"); // works everywhere (ADR-0043)
    if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const onSession = (attention.focus ?? (!$("panel").hidden ? "panel" : null) ?? attention.hover) !== null;
    if (onSession && ev.key === " ") retire("snooze");
    if (/^[wq]$/i.test(ev.key)) retire("jump");
  }, true);
  update();
}
