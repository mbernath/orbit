// @ts-check
// The popover of a colour swatch (ADR-0045): a large preview and the colour as hex, rgb() and hsl(), each copied with
// a click (copy.js). Capture phase, so a click on a swatch never also opens the editor or selects an element.
import { colorFormats } from "./color-ref.js";
import { esc } from "./util.js";

/** @type {{ pop: HTMLElement, from: HTMLElement } | null} */
let open = null;

function close() {
  if (!open) return;
  open.pop.remove();
  open.from.focus();
  open = null;
}

/** @param {HTMLElement} from */
function show(from) {
  close();
  const f = colorFormats(from.dataset.color ?? "");
  const pop = document.createElement("div");
  pop.className = "menu color-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `Colour ${f.hex}`);
  pop.innerHTML =
    `<div class="color-big" style="--c:${esc(f.hex)}"></div>` +
    [f.hex, f.rgb, f.hsl]
      .map((v) => `<button type="button" data-copy="text" data-copy-text="${esc(v)}" title="Copy">${esc(v)}</button>`)
      .join("");
  document.body.append(pop);
  const r = from.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  open = { pop, from };
  /** @type {HTMLElement | null} */ (pop.querySelector("button"))?.focus();
}

document.addEventListener(
  "click",
  (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const s = /** @type {HTMLElement | null} */ (t.closest?.("button.swatch"));
    if (s) {
      ev.preventDefault();
      ev.stopPropagation();
      if (open?.from === s) close();
      else show(s);
    } else if (open && !open.pop.contains(t)) close();
  },
  true,
);
document.addEventListener("pointerdown", (ev) => {
  const t = /** @type {HTMLElement} */ (ev.target);
  if (open && !open.pop.contains(t) && !t.closest?.("button.swatch")) close();
}, true);
document.addEventListener(
  "keydown",
  (ev) => {
    if (ev.key !== "Escape" || !open) return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  },
  true,
);
