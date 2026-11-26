// @ts-check
// Clicks on local file references in rendered text (a.file-link): a click previews the file in Orbit (ADR-0040),
// ⌘/Ctrl-click opens it outside through files.open (ADR-0030).
// Capture phase, so the click never also opens the editor or selects an element underneath.
import { openOutside, openPreview } from "./file-preview.js";

document.addEventListener(
  "click",
  (ev) => {
    const a = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest?.("a.file-link"));
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    const line = Number(a.dataset.line);
    const target = { path: a.dataset.file ?? "", base: a.dataset.base ?? null, line: line > 0 ? line : null };
    if (ev.metaKey || ev.ctrlKey) openOutside(target);
    else void openPreview(target);
  },
  true,
);
