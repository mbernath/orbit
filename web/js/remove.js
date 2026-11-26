// @ts-check
// Taking an element off the board and bringing it back (elements.md table; interaction.md "Undo").
// Sessions are archived on the canvas; documents are unpinned (their file stays untouched).
import { runAction } from "./api.js";
import { store } from "./store.js";
import { offerUndo } from "./undo.js";

/** @param {string} ref @param {() => void} done called after the change and after an undo */
export async function takeOff(ref, done) {
  const e = store.byRef.get(ref);
  if (!e) return;
  // remember what undo needs now: an unpinned document is no longer in the store afterwards
  const path = e.kind === "file" ? /** @type {{ path: string }} */ (e.data).path : null;
  const name = e.kind === "file" ? /** @type {{ rel: string }} */ (e.data).rel : e.title;
  // a list node goes with its configuration; undo pins it again with the same command, title and interval (ADR-0036)
  const list = e.kind === "list" ? /** @type {{ id: string, command: string, title: string | null, interval: number }} */ (e.data) : null;
  const set = (/** @type {boolean} */ off) =>
    path ? runAction(off ? "files.unpin" : "files.pin", { path })
    : list ? (off ? runAction("lists.remove", { id: list.id }) : runAction("lists.add", { workspaceId: e.workspaceId, command: list.command, title: list.title ?? "", interval: list.interval }))
    : runAction("canvas.archive", { refs: [ref], archived: off });
  if (!(await set(true)).ok) return;
  done();
  // a session in a worktree Orbit created offers to remove that too — only on this explicit click (ADR-0017)
  const ctl = e.kind === "session" ? store.related(e, "control")[0] : undefined;
  const ctlId = /** @type {string | undefined} */ (ctl?.data.id);
  const extra = ctlId && ctl?.data.worktree
    ? { label: "Also remove worktree", run: async () => (await runAction("owned.removeWorktree", { id: ctlId }, { confirm: true }), done()) }
    : undefined;
  offerUndo({ text: `“${name}” ${path || list ? "unpinned" : "removed from board"}`, undo: async () => (await set(false), done()), extra });
}

/** Bring an archived session back from the archive list. @param {string} ref */
export const bringBack = (ref) => runAction("canvas.archive", { refs: [ref], archived: false });
