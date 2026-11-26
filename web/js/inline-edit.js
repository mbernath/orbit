// @ts-check
// Inline edit for fields views declare with data-edit (see views/registry.js): Enter or leaving saves, Esc discards.
// An empty value, or the placeholder (the automatic value), resets the field to null.
import { runAction } from "./api.js";

/**
 * @param {HTMLElement} field the element carrying data-edit
 * @param {() => void} done called after saving or discarding
 */
export function startInlineEdit(field, done) {
  const input = document.createElement("input");
  input.className = "title-input";
  input.value = field.dataset.value ?? "";
  input.placeholder = field.dataset.placeholder ?? "";
  input.dataset.editing = "1";
  field.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  /** @param {boolean} save */
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const value = input.value.trim();
      const auto = field.dataset.placeholder;
      await runAction(field.dataset.edit ?? "", { ...JSON.parse(field.dataset.input ?? "{}"), [field.dataset.field ?? "value"]: value && value !== auto ? value : null });
    }
    done();
  };
  input.addEventListener("keydown", (k) => {
    if (k.key === "Enter") finish(true);
    if (k.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}
