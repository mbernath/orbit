// @ts-check
// Where a session works (ADR-0017): own worktree, main checkout or a folder without git, and the quiet warning when
// two active sessions share one main checkout.
import { store } from "../store.js";

/** @typedef {import("./registry.js").Entity} Entity */

const data = (/** @type {Entity} */ e) => /** @type {Record<string, any>} */ (e.data);

/** "separate worktree · feat/x", "main checkout · main" or "folder without Git" @param {Entity} e */
export function locationOf(e) {
  const d = data(e);
  if (!d.gitRoot) return "folder without Git";
  const where = d.workTree ? "separate worktree" : "main checkout";
  return d.branch ? `${where} · ${d.branch}` : where;
}

/** working or waiting, by the hook or by Orbit running it @param {Entity} e */
const active = (e) => {
  const ctl = store.related(e, "control")[0];
  return e.status === "working" || e.status === "waiting" || ctl?.status === "working" || ctl?.status === "permission";
};

/** Other active sessions in the same main checkout (none when this one works in its own worktree). @param {Entity} e */
export function sharingCheckout(e) {
  const d = data(e);
  if (!d.gitRoot || d.workTree || !active(e)) return [];
  return store.entities.filter(
    (o) => o.kind === "session" && o.ref !== e.ref && !store.isArchived(o.ref) && data(o).gitRoot === d.gitRoot && !data(o).workTree && active(o),
  );
}

/** "Works in the same checkout as “X”." or "" @param {Entity} e */
export function sharingWarning(e) {
  const others = sharingCheckout(e);
  if (!others.length) return "";
  const names = others.slice(0, 2).map((o) => `“${o.title}”`).join(" and ");
  return `Works in the same checkout as ${names}${others.length > 2 ? ` and ${others.length - 2} more` : ""}.`;
}
