// @ts-check
// Attachments for a message (ADR-0021): drop files onto the field, paste them (⌘V) or pick them with the button.
// Shows them as small chips that can be removed; files travel base64 with the action.
import { tip } from "./key-table.js";

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

/** @typedef {{ name: string, type: string, data: string }} Attachment */

/** @param {File} f @returns {Promise<Attachment>} */
const read = (f) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name || "pasted.png", type: f.type || "application/octet-stream", data: String(r.result).split(",")[1] ?? "" });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/**
 * @param {HTMLElement} host where the chips and the button go
 * @param {HTMLElement} field the text field that accepts drop and paste
 */
export function createAttachments(host, field) {
  /** @type {Attachment[]} */
  let items = [];
  host.classList.add("attach");
  // a paper clip in the field's corner; dropping and pasting work on the whole field (ADR-0021)
  host.innerHTML = `<div class="att-chips"></div>
    <label class="att-pick" title="${tip("Attach file, or drop it here", "paste", "field")}"><input type="file" multiple hidden aria-label="Attach file" />
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M10.5 4.5 5.8 9.2a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6l4.2-4.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></label>
    <span class="att-error" hidden></span>`;
  const zone = /** @type {HTMLElement} */ (host.closest(".composer") ?? field);
  const chips = /** @type {HTMLElement} */ (host.querySelector(".att-chips"));
  const input = /** @type {HTMLInputElement} */ (host.querySelector("input[type=file]"));
  const error = /** @type {HTMLElement} */ (host.querySelector(".att-error"));

  function show() {
    chips.innerHTML = "";
    items.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "att-chip";
      chip.textContent = a.name;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${a.name}`);
      x.addEventListener("click", () => ((items = items.filter((_, j) => j !== i)), show()));
      chip.append(x);
      chips.append(chip);
    });
  }

  /** @param {FileList | File[] | null | undefined} files */
  async function add(files) {
    error.hidden = true;
    for (const f of [...(files ?? [])]) {
      if (items.length >= MAX_FILES) return fail(`At most ${MAX_FILES} attachments.`);
      if (f.size > MAX_BYTES) return fail(`“${f.name}” is larger than 10 MB.`);
      items.push(await read(f));
    }
    show();
  }
  /** @param {string} text */
  const fail = (text) => ((error.textContent = text), (error.hidden = false), show());

  input.addEventListener("change", () => (add(input.files), (input.value = "")));
  field.addEventListener("paste", (ev) => {
    const files = [...(ev.clipboardData?.files ?? [])];
    if (files.length) (ev.preventDefault(), add(files));
  });
  zone.addEventListener("dragover", (ev) => (ev.preventDefault(), zone.classList.add("drop")));
  zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
  zone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    zone.classList.remove("drop");
    add(ev.dataTransfer?.files);
  });

  return {
    list: () => items,
    clear: () => ((items = []), show()),
  };
}
