// @ts-check
// Copy buttons ([data-copy]) in rendered text: "code" copies the code block it sits in, "text" its own
// data-copy-text; any other value asks the
// source registered for its container ([data-copy-source]). One capture listener, so a copy click never also
// opens the editor or selects an element underneath.

/** @type {Map<string, (button: HTMLElement) => string | undefined>} */
const sources = new Map();

/** Register where a container's copy buttons take their text from. @param {string} name @param {(button: HTMLElement) => string | undefined} get */
export function copySource(name, get) {
  sources.set(name, get);
}

/** @param {HTMLElement} b @returns {string | undefined} */
function textFor(b) {
  if (b.dataset.copy === "code") return b.closest(".code")?.querySelector("pre")?.textContent ?? undefined;
  if (b.dataset.copy === "text") return b.dataset.copyText;
  const name = /** @type {HTMLElement | null} */ (b.closest("[data-copy-source]"))?.dataset.copySource;
  return name ? sources.get(name)?.(b) : undefined;
}

/** @param {HTMLElement} b @param {boolean} ok */
function confirm(b, ok) {
  const title = b.title;
  b.title = ok ? "Copied" : "Could not copy";
  b.classList.add(ok ? "done" : "failed"); // the icon is CSS content, so the text of the bubble stays the message
  setTimeout(() => {
    b.title = title;
    b.classList.remove("done", "failed");
  }, 1200);
}

document.addEventListener(
  "click",
  async (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest?.("[data-copy]"));
    if (!b) return;
    ev.stopPropagation();
    ev.preventDefault();
    const text = textFor(b);
    if (text == null) return confirm(b, false);
    try {
      await navigator.clipboard.writeText(text);
      confirm(b, true);
    } catch {
      confirm(b, false);
    }
  },
  true,
);
