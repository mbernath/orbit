// @ts-check
// Agent body of the detail panel (ADR-0015, ADR-0016): role and trigger (editable; the trigger is read again and
// shown back), "Run now", a pending question of the current run, the last runs (each opens its conversation),
// and deleting the agent with an in-place confirmation. Same interface as panel-doc.js.
import { runAction } from "./api.js";
import { store } from "./store.js";
import { ago, esc } from "./util.js";
import { currentRun } from "./views/agent-dot.js";
import { inputAttr } from "./views/registry.js";
import { permissionRow } from "./views/session-dot.js";

/** @type {Record<string, string>} */
const MODEL_NAMES = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

/**
 * @param {HTMLElement} host
 * @param {string} ref
 * @param {{ refresh: () => Promise<void>, openRun: (sessionRef: string) => void, deleted: () => void }} ctx
 */
export function mountAgent(host, ref, ctx) {
  const agent = () => store.byRef.get(ref);
  let confirmDelete = false;
  host.innerHTML = `
    <div class="p-info p-agent">
      <label class="p-field">Role<textarea data-a="role" rows="2"></textarea></label>
      <label class="p-field">When does it run?<input data-a="trigger" placeholder="e.g. after every merge into main" /></label>
      <p class="p-reading"></p>
      <div class="p-live"></div>
    </div>
    <div class="p-conv p-runs" aria-label="Runs"></div>`;
  const role = /** @type {HTMLTextAreaElement} */ (host.querySelector('[data-a="role"]'));
  const trigger = /** @type {HTMLInputElement} */ (host.querySelector('[data-a="trigger"]'));

  /** saves role or trigger when the field is left; a new trigger text is read again by the server */
  const save = async () => {
    const d = /** @type {any} */ (agent()?.data);
    if (!d || (role.value.trim() === d.role && trigger.value.trim() === d.trigger)) return;
    await runAction("agents.update", { id: d.id, role: role.value.trim(), trigger: trigger.value.trim() });
    await ctx.refresh();
  };
  /** @param {HTMLElement} f */
  const wire = (f) => {
    f.addEventListener("blur", save);
    f.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") (ev.stopPropagation(), update(true), f.blur());
      if (ev.key === "Enter" && f === trigger) f.blur();
    });
  };
  wire(role);
  wire(trigger);

  host.addEventListener("click", async (ev) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest("[data-a]"));
    const d = /** @type {any} */ (agent()?.data);
    if (!b || !d) return;
    const what = b.dataset.a;
    if (what === "run-open") return ctx.openRun(b.dataset.ref ?? "");
    if (what === "delete") return (confirmDelete = true), update();
    if (what === "delete-cancel") return (confirmDelete = false), update();
    if (what === "delete-go") {
      const r = await runAction("agents.delete", { id: d.id }, { confirm: true });
      if (r.ok) ctx.deleted();
    }
  });

  /** @param {boolean} [fields] also reset the text fields (else they keep what the user types) */
  function update(fields = false) {
    const e = agent();
    if (!e) return;
    const d = /** @type {any} */ (e.data);
    if (fields || document.activeElement !== role) role.value = d.role;
    if (fields || document.activeElement !== trigger) trigger.value = d.trigger;
    const reading = /** @type {HTMLElement} */ (host.querySelector(".p-reading"));
    reading.textContent = d.reading;
    reading.classList.toggle("warn", !d.understood);
    const run = currentRun(e);
    /** @type {HTMLElement} */ (host.querySelector(".p-live")).innerHTML = `
      ${permissionRow(run)}
      <div class="b-btns">${
        e.status === "running" ? `<span class="p-note">Running …</span>` : `<button class="btn" data-action="agents.run" ${inputAttr({ id: d.id })}>Run now</button>`
      }${
        confirmDelete
          ? `<span class="p-confirm"><span>Delete agent? Its memory stays.</span><button class="btn" data-a="delete-go">Delete</button><button class="btn quiet" data-a="delete-cancel">Cancel</button></span>`
          : `<button class="btn quiet" data-a="delete">Delete …</button>`
      }</div>
      <p class="p-note">${esc([MODEL_NAMES[d.model] ?? d.model, d.nextRunAt ? `next run ${new Date(d.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : null].filter(Boolean).join(" · "))}</p>`;
    const runs = /** @type {{ sessionId: string, cause: string, at: number }[]} */ (d.runs ?? []);
    /** @type {HTMLElement} */ (host.querySelector(".p-runs")).innerHTML = runs.length
      ? runs.map((r) => `<button class="p-run-item" data-a="run-open" data-ref="session:claude/${esc(r.sessionId)}"><span>${esc(r.cause)}</span><em>${esc(ago(r.at))}</em></button>`).join("")
      : `<p class="p-note">No runs yet.</p>`;
  }

  update(true);
  return {
    update: () => update(),
    escape: () => false,
    edit: () => trigger.focus(),
    title: () => /** @type {any} */ (agent()?.title ?? ""),
  };
}
