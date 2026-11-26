// @ts-check
// A lasting notice when the installed Claude Code hook lacks events Orbit needs (ADR-0031). Without them a session's
// state goes stale (e.g. "waiting" after a granted permission), so the notice stays until the install is current.
// With no Orbit hook at all and at least one island, a quiet line with the install command instead (ADR-0041);
// the stale notice wins. Checked on load and whenever the board gets focus again — after running the installer,
// the user comes back here. syncHookNotice() runs with every render, so a first island shows the quiet line at once.
import { loadHookCheck } from "./api.js";
import { store } from "./store.js";
import { $ } from "./util.js";

/** @type {import("../../src/core/types").HookCheck} */
let last = { missing: [], installed: true };

/** @param {string} before @param {string} after */
function fill(/** @type {HTMLElement} */ box, before, after) {
  box.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = before;
  const cmd = document.createElement("code");
  cmd.textContent = "bun run hooks:install";
  cmd.className = "no-drag";
  const rest = document.createElement("span");
  rest.textContent = after;
  box.append(text, " ", cmd, rest);
}

export function syncHookNotice() {
  const box = $("hook-notice");
  const kind = last.missing.length ? "stale" : !last.installed && store.workspaces.length > 0 ? "missing" : "";
  if (box.dataset.kind === kind) return; // write only on change, like every board update
  box.dataset.kind = kind;
  box.hidden = !kind;
  box.classList.toggle("quiet", kind === "missing");
  if (kind === "stale")
    fill(box, `Orbit's hooks are out of date (missing ${last.missing.join(", ")}), so session states can be wrong. In the Orbit folder, run`, " and restart running Claude sessions.");
  if (kind === "missing") fill(box, "Live status needs Claude Code's hook. In the Orbit folder, run", ", then restart Claude sessions.");
}

async function check() {
  last = await loadHookCheck();
  delete $("hook-notice").dataset.kind; // the missing events may have changed
  syncHookNotice();
}

check();
window.addEventListener("focus", check);
