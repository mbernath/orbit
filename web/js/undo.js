// @ts-check
// Undo for taking things off the board (interaction.md "Undo"): one status line for 8 s, ⌘Z undoes the last one.
import { $ } from "./util.js";

/** extra: one more explicit choice in the status line, e.g. "Also remove worktree" (never automatic)
 * @typedef {{ text: string, undo: () => Promise<unknown>, extra?: { label: string, run: () => Promise<unknown> } }} Undoable */

/** @type {Undoable[]} */
const stack = [];
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

/** Remember a removal and show "… · Undo". @param {Undoable} u */
export function offerUndo(u) {
  stack.push(u);
  if (stack.length > 20) stack.shift();
  const line = $("status");
  line.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = u.text;
  const btn = document.createElement("button");
  btn.className = "btn quiet";
  btn.textContent = "Undo";
  btn.addEventListener("click", () => undoLast());
  line.append(text, btn);
  if (u.extra) {
    const { label, run } = u.extra;
    const more = document.createElement("button");
    more.className = "btn quiet";
    more.textContent = label;
    more.addEventListener("click", async () => {
      more.disabled = true;
      await run();
      line.hidden = true;
    });
    line.append(more);
  }
  line.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (line.hidden = true), 8000);
}

/** A short note in the same status line, without undo, e.g. "Alles erledigt". @param {string} text */
export function say(text) {
  const line = $("status");
  line.textContent = text;
  line.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (line.hidden = true), 4000);
}

/** Undo the most recent removal (⌘Z). @returns {Promise<boolean>} whether there was one */
export async function undoLast() {
  const u = stack.pop();
  $("status").hidden = true;
  if (!u) return false;
  await u.undo();
  return true;
}
