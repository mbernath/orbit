// @ts-check
// "Pin list …" behind the island's "+" (ADR-0036), as a dialog anchored there (ADR-0042): a command (typed or picked
// with the native file dialog), a trial run that shows what would be pinned, then title and interval. "Pin" is
// enabled only after a good trial run.
import { loadListGuide, runAction } from "../api.js";
import { openDialog } from "../dialog.js";
import { intervalOptions } from "../panel-list.js";
import { esc } from "../util.js";

/**
 * @param {{ id: string, name: string }} ws
 * @param {HTMLElement | { x: number, y: number }} anchor
 * @param {(ref: string) => void} done called with the new list's ref
 */
export function openListPin(ws, anchor, done) {
  let tried = ""; // the command the last good trial ran
  let seq = 0;
  const d = openDialog({
    cls: "list-pin",
    anchor,
    title: `Pin list in <b>${esc(ws.name)}</b>`,
    body: `
      <div class="path-row"><input name="command" required spellcheck="false" placeholder="Command, e.g. ./scripts/todos.sh" aria-label="Command" /><button type="button" class="btn pick-script">Choose script …</button></div>
      <p class="list-trial p-meta">Orbit runs the command in the island’s folder.</p>
      <p class="p-meta list-guide">No script yet? <button type="button" class="linkish copy-guide">Copy the script guide</button> and give it to a session on the island.</p>
      <input name="title" placeholder="Title" aria-label="Title" />
      <select name="interval" aria-label="Refresh">${intervalOptions(300)}</select>`,
    submit: "Pin",
    async onSubmit(f) {
      if (command.value.trim() !== tried) return "Try the command first: Enter runs it."; // Pin stays off until then
      const interval = Number(/** @type {HTMLSelectElement} */ (f.elements.namedItem("interval")).value);
      const r = await runAction("lists.add", { workspaceId: ws.id, command: tried, title: title.value.trim(), interval }, { quiet: true });
      if (!r.ok) return r.error;
      done(/** @type {{ ref: string }} */ (r.data).ref);
    },
  });
  const f = d.form;
  const command = /** @type {HTMLInputElement} */ (f.elements.namedItem("command"));
  const title = /** @type {HTMLInputElement} */ (f.elements.namedItem("title"));
  const trial = /** @type {HTMLElement} */ (f.querySelector(".list-trial"));
  const submit = /** @type {HTMLButtonElement} */ (f.querySelector("button[type=submit]"));
  submit.disabled = true;

  async function test() {
    const cmd = command.value.trim();
    if (!cmd || cmd === tried) return;
    const mine = ++seq;
    tried = "";
    submit.disabled = true;
    d.error(null);
    trial.textContent = "Trial run …";
    const r = await runAction("lists.test", { workspaceId: ws.id, command: cmd }, { quiet: true });
    if (mine !== seq) return; // a newer command was typed meanwhile
    if (!r.ok) return (trial.textContent = ""), d.error(r.error);
    const p = /** @type {{ title: string | null, total: number, sections: unknown[], blocked: number }} */ (r.data);
    tried = cmd;
    submit.disabled = false;
    trial.textContent = `${p.total} ${p.total === 1 ? "entry" : "entries"}${p.sections.length > 1 ? ` in ${p.sections.length} sections` : ""}${p.blocked ? `, ${p.blocked} blocked` : ""}.`;
    if (!title.value.trim()) title.placeholder = p.title ?? "Title";
  }

  command.addEventListener("change", test);
  command.addEventListener("input", () => command.value.trim() !== tried && (submit.disabled = true));
  command.addEventListener("keydown", (ev) => ev.key === "Enter" && (ev.preventDefault(), test()));
  f.querySelector(".copy-guide")?.addEventListener("click", async (ev) => {
    const b = /** @type {HTMLButtonElement} */ (ev.currentTarget);
    const guide = await loadListGuide();
    try {
      if (!guide) throw new Error("no guide");
      await navigator.clipboard.writeText(guide);
      b.textContent = "Guide copied ✓";
    } catch {
      d.error("Could not copy the guide. Try again.");
    }
  });
  f.querySelector(".pick-script")?.addEventListener("click", async () => {
    const r = await runAction("lists.pickScript", { workspaceId: ws.id }, { quiet: true });
    if (!r.ok) return d.error(r.error);
    const picked = /** @type {{ command: string | null }} */ (r.data).command;
    if (picked) (command.value = picked), test();
  });
}
