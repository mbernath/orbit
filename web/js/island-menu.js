// @ts-check
// The "+" beside an island name only adds (ADR-0042): New session (N), New agent, Pin file, Pin list. Small menu at
// its control; arrows, Enter, Esc. Its forms open as a dialog anchored at the "+"; "New island" (double-click on free
// space, first run) the same at the point. Everything about the island itself lives in its panel (panel-island.js).
import { runAction } from "./api.js";
import { createAttachments } from "./attach.js";
import { openDialog } from "./dialog.js";
import { openFilePicker } from "./dialogs/file-picker.js";
import { openListPin } from "./dialogs/list-pin.js";
import { frameNode } from "./render.js";
import { NO_WS, store } from "./store.js";
import { closest, esc, kbd } from "./util.js";
import { runSelects } from "./views/run-options.js";

/** @typedef {HTMLElement | { x: number, y: number }} Anchor */

/** The form's fields as action input: empty ones left out, "true" as a boolean. @param {HTMLFormElement} f */
const fields = (f) => Object.fromEntries([...new FormData(f)].filter(([, v]) => v !== "").map(([k, v]) => [k, v === "true" ? true : v]));

/**
 * @param {{ refresh: () => Promise<void>, reveal: (ref: string) => void, revealIsland: (id: string) => void }} ctx
 */
export function createIslandMenu(ctx) {
  /** @type {HTMLElement | null} */
  let menu = null;
  let island = "";
  /** @type {Anchor} */
  let anchor = { x: 0, y: 0 };
  /** the island a form acts on stays marked while it is open */
  const mark = (/** @type {boolean} */ on) => island && frameNode(island)?.classList.toggle("target", on);

  const close = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    mark(false);
  };

  /**
   * A form behind "+": anchored dialog, runs the action, closes on success. @param {string} title HTML
   * @param {string} body @param {string} submit @param {string} action @param {() => Record<string, unknown>} extra
   * @param {(data: any) => void} after
   */
  function form(title, body, submit, action, extra, after) {
    close();
    mark(true);
    return openDialog({
      title, body, submit, anchor,
      onClose: () => mark(false),
      async onSubmit(f) {
        const r = await runAction(action, { ...extra(), ...fields(f) }, { quiet: true });
        if (!r.ok) return r.error;
        await ctx.refresh();
        after(r.data);
      },
    });
  }

  function main() {
    const real = island !== NO_WS;
    if (!menu) return;
    menu.innerHTML = `
      ${real ? `<button data-menu="new-session">New session …${kbd("N")}</button><button data-menu="new-agent">New agent …</button>` : ""}
      <button data-menu="pin">Pin file …</button>
      ${real ? `<button data-menu="pin-list">Pin list …</button>` : ""}`;
    /** @type {HTMLElement | null} */ (menu.querySelector("button"))?.focus();
  }

  /** @param {HTMLElement} b */
  function choose(b) {
    const what = b.dataset.menu;
    if (what === "pin") return close(), openFilePicker(async (ref) => (await ctx.refresh(), ctx.reveal(ref)));
    const ws = store.workspaces.find((w) => w.id === island);
    if (!ws) return;
    if (what === "pin-list") return close(), openListPin(ws, anchor, async (ref) => (await ctx.refresh(), ctx.reveal(ref)));
    if (what === "new-session") return newSession(ws);
    if (what === "new-agent") return newAgent(ws);
  }

  /** @param {string[]} paths @param {string} name */
  const folderSelect = (paths, name) =>
    paths.length > 1
      ? `<select name="${name}" aria-label="Folder">${paths.map((p) => `<option value="${esc(p)}">${esc(p.split("/").filter(Boolean).slice(-2).join("/"))}</option>`).join("")}</select>`
      : "";

  /** A session Orbit runs itself (ADR-0019): first message, folder of the island, model and thinking effort. @param {import("./store.js").Workspace} ws */
  function newSession(ws) {
    const { set, claude } = /** @type {{ set: import("./views/run-options.js").RunValues, claude: import("./views/run-options.js").RunValues }} */ (
      store.byRef.get(`defaults:owned/${ws.id}`)?.data ?? { set: {}, claude: {} });
    const effective = { model: set.model ?? claude.model, effort: set.effort ?? claude.effort, mode: set.mode ?? claude.mode };
    /** @type {{ list: () => unknown[] } | null} */
    let files = null;
    const d = form(
      `New session in <b>${esc(ws.name)}</b>`,
      `<div class="composer"><textarea name="text" rows="3" required placeholder="What should it do?" aria-label="First message"></textarea><div class="menu-attach"></div></div>
       ${folderSelect(ws.paths, "cwd") || `<input type="hidden" name="cwd" value="${esc(ws.paths[0] ?? "")}" />`}
       ${runSelects({}, effective)}
       <label class="check"><input type="checkbox" name="worktree" value="true" /> Separate worktree instead of the main checkout</label>`,
      "Start",
      "owned.start",
      () => (files?.list().length ? { attachments: files.list() } : {}),
      (data) => ctx.reveal(data.ref),
    );
    files = createAttachments(/** @type {HTMLElement} */ (d.el.querySelector(".menu-attach")), /** @type {HTMLTextAreaElement} */ (d.el.querySelector("textarea")));
  }

  /** An agent (ADR-0015): name, role, trigger in plain words (read once into a rule), folder of the island. @param {import("./store.js").Workspace} ws */
  function newAgent(ws) {
    form(
      `New agent in <b>${esc(ws.name)}</b>`,
      `<input name="name" required placeholder="Name, e.g. Roadmap keeper" aria-label="Name" />
       <textarea name="role" rows="2" required placeholder="What is its job in ${esc(ws.name)}?" aria-label="Role"></textarea>
       <input name="trigger" placeholder="When does it run? e.g. after every merge into main" aria-label="Trigger" />
       ${folderSelect(ws.paths, "folder")}`,
      "Create",
      "agents.create",
      () => ({ workspaceId: ws.id }),
      (data) => ctx.reveal(data.ref),
    );
  }

  function newIsland() {
    const d = form(
      "New island",
      `<input name="name" placeholder="Name, e.g. customer-portal" required aria-label="Name" />
       <div class="path-row"><input name="path" placeholder="Folder, e.g. ~/Src/customer-portal" required aria-label="Folder" /><button type="button" class="btn pick-folder">Choose folder …</button></div>`,
      "Create",
      "workspaces.add",
      () => ({}),
      (data) => ctx.revealIsland(data.id),
    );
    const name = /** @type {HTMLInputElement} */ (d.form.elements.namedItem("name"));
    const path = /** @type {HTMLInputElement} */ (d.form.elements.namedItem("path"));
    d.el.querySelector(".pick-folder")?.addEventListener("click", async () => {
      const r = await runAction("workspaces.pickFolder", {}, { quiet: true });
      if (!r.ok) return d.error(r.error);
      const picked = /** @type {{ path: string | null }} */ (r.data).path;
      if (!picked) return;
      path.value = picked;
      if (!name.value.trim()) name.value = picked.split("/").filter(Boolean).pop() ?? "";
      d.error(null);
    });
  }

  return {
    close,
    isOpen: () => !!menu,
    /**
     * @param {string} id island ("" for none, e.g. a new island from free space)
     * @param {Anchor} at the control that opened it, or a screen point
     * @param {"main" | "new-session" | "new-island"} [view]
     */
    open(id, at, view = "main") {
      close();
      island = id;
      anchor = at;
      if (view === "new-island") return newIsland();
      if (view === "new-session") {
        const ws = store.workspaces.find((w) => w.id === id);
        return ws ? newSession(ws) : undefined;
      }
      menu = document.createElement("div");
      menu.className = "menu";
      menu.setAttribute("role", "menu");
      mark(true); // it is clear where a new session goes
      document.body.append(menu);
      main();
      const r = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, bottom: at.y };
      menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
      menu.addEventListener("click", (ev) => {
        const b = closest(ev.target, "[data-menu]");
        if (b) choose(b);
      });
      menu.addEventListener("keydown", (ev) => {
        const items = /** @type {HTMLElement[]} */ ([...(menu?.querySelectorAll("button:not([disabled])") ?? [])]);
        const i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        if (ev.key === "Escape") return ev.stopPropagation(), close();
        if (ev.key === "ArrowDown") (ev.preventDefault(), items[(i + 1) % items.length]?.focus());
        if (ev.key === "ArrowUp") (ev.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus());
      });
    },
  };
}
