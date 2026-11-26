// @ts-check
// A PR chip that may be a stack (ADR-0038), the same at the island's pill and at a session: one PR links straight to
// GitHub; more lie as an offset box behind the chip, and a click lists them all in a small menu at the chip.
import { prLevel, prWord } from "./orphan-prs.js";
import { store } from "./store.js";
import { closest, esc } from "./util.js";

/** @typedef {import("./store.js").Entity} Entity */

/**
 * @param {{ prs: Entity[], text: string, cls: string, hint?: string }} o the stack's PRs, first one on top
 * @returns {string}
 */
export function prStack({ prs, text, cls, hint = "" }) {
  const top = prs[0];
  if (!top) return "";
  const url = String(/** @type {any} */ (top.data).url);
  const more = prs.length > 1;
  const rest = prs.length - 1;
  const title = more ? `${hint ? `${hint} · ` : ""}${rest} more PR${rest > 1 ? "s" : ""}, click to list` : hint;
  const stack = more ? ` data-pr-stack="${esc(prs.map((p) => p.ref).join(" "))}"` : "";
  return `<a class="${cls}${more ? " stacked" : ""}" href="${esc(url)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ""}${stack}>${esc(text)}</a>`;
}

/** @type {HTMLElement | null} */
let menu = null;
const close = () => (menu?.remove(), (menu = null));

/** @param {HTMLElement} chip */
function open(chip) {
  close();
  const prs = (chip.dataset.prStack ?? "").split(" ").map((r) => store.byRef.get(r)).filter((e) => !!e);
  const rows = prs.map((pr) => {
    const d = /** @type {Record<string, any>} */ (pr.data);
    // the number in its state's colour, as on the pill; the state's word on hover
    return `<a class="pr-row" href="${esc(d.url)}" target="_blank" rel="noopener" title="${esc(prWord(pr))}"><span class="pr-row-num ${prLevel(pr)}">#${esc(d.number)}</span><span class="pr-row-title">${esc(pr.title)}</span></a>`;
  });
  menu = document.createElement("div");
  menu.className = "menu pr-menu";
  menu.innerHTML = rows.join("");
  document.body.append(menu);
  const r = chip.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
  menu.addEventListener("click", (ev) => closest(ev.target, "a") && close());
  /** @type {HTMLElement | null} */ (menu.querySelector("a"))?.focus();
}

/** Wires stacks on the whole board: click opens the list, outside or Esc closes it. */
export function installPrStack() {
  document.addEventListener(
    "click",
    (ev) => {
      const chip = closest(ev.target, "[data-pr-stack]");
      if (!chip) return;
      ev.preventDefault();
      ev.stopPropagation();
      menu ? close() : open(chip);
    },
    true,
  );
  document.addEventListener("pointerdown", (ev) => {
    if (menu && !closest(ev.target, ".pr-menu, [data-pr-stack]")) close();
  });
  document.addEventListener(
    "keydown",
    (ev) => {
      if (menu && ev.key === "Escape") (ev.stopPropagation(), close());
    },
    true,
  );
}
