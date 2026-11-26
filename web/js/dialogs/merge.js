// @ts-check
// Confirmation dialog for merging a pull request (ADR-0006, irreversible action → confirm: true), centred (ADR-0042).
import { runAction } from "../api.js";
import { openDialog } from "../dialog.js";
import { store } from "../store.js";
import { esc } from "../util.js";
import { CI } from "../views/labels.js";

const METHOD = /** @type {Record<string, string>} */ ({ squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" });

/** @param {string} ref @param {() => void} onDone */
export function openMergeDialog(ref, onDone) {
  const pr = store.byRef.get(ref);
  if (!pr) return;
  const p = /** @type {Record<string, any>} */ (pr.data);
  /** @type {string[]} */
  const methods = p.mergeMethods?.length ? p.mergeMethods : ["squash"];
  const chosen = methods.includes("squash") ? "squash" : methods[0] ?? "squash";
  const d = openDialog({
    cls: "merge-dialog",
    title: esc(`#${p.number} ${pr.title}`),
    sub: `${p.repo} · ${p.branch} · ${CI[p.ci] ?? ""}`,
    body: `<select name="method" aria-label="Method">${methods.map((m) => `<option value="${m}"${m === chosen ? " selected" : ""}>${METHOD[m]}</option>`).join("")}</select>
      <input name="subject" aria-label="Commit title" placeholder="Commit title" value="${esc(`${pr.title} (#${p.number})`)}" />
      <label class="check"><input type="checkbox" name="deleteBranch" checked /> Delete branch after merge</label>`,
    submit: "Merge",
    async onSubmit(form) {
      const f = form.elements;
      const r = await runAction(
        "github.merge",
        {
          repo: p.repo, number: p.number, method: /** @type {HTMLSelectElement} */ (f.namedItem("method")).value,
          deleteBranch: /** @type {HTMLInputElement} */ (f.namedItem("deleteBranch")).checked,
          subject: /** @type {HTMLInputElement} */ (f.namedItem("subject")).value,
        },
        { confirm: true, quiet: true },
      );
      if (!r.ok) return `Merge failed: ${r.error}`;
      onDone();
    },
  });
  const method = /** @type {HTMLSelectElement} */ (d.form.elements.namedItem("method"));
  const subject = /** @type {HTMLInputElement} */ (d.form.elements.namedItem("subject"));
  const sync = () => void (subject.hidden = method.value === "rebase"); // a rebase has no merge commit to title
  method.addEventListener("change", sync);
  sync();
  /** @type {HTMLButtonElement} */ (d.form.querySelector("button[type=submit]")).focus();
}
