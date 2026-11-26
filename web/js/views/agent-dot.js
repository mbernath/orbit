// @ts-check
// Agent (docs/design/elements.md, ADR-0015): the session glyph plus a small moon. The dot shows the current run;
// role and trigger at depth 2, the last runs at depth 3, "Run now" and a pending question in the action area.
// Its runs are sessions that belong to it (their control entity carries the key agent:<id>) and get no dots of their own.
import { renderMarkdown } from "../markdown.js";
import { store } from "../store.js";
import { ago, esc } from "../util.js";
import { glyphSlot, inputAttr, registerView } from "./registry.js";
import { permissionRow } from "./session-dot.js";

/** @typedef {import("./registry.js").Entity} Entity */

/** The newest run's control entity, if any. @param {Entity} agent */
export function currentRun(agent) {
  return store.related(agent, "control").sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** @param {Entity} e */
function glyphState(e) {
  const run = currentRun(e);
  if (run?.status === "permission") return "waiting";
  if (run?.status === "working" || e.status === "running") return "working";
  return "rest";
}

registerView({
  id: "dot",
  kind: "agent",
  size: () => ({ w: 280, h: 160 }),
  anchor: { x: 16, y: 80 },
  slot: glyphSlot,
  bubbleAt: (e, depth) => depth >= 2 || (depth >= 1 && glyphState(e) !== "rest") || currentRun(e)?.status === "permission",
  prio: (e) => (currentRun(e)?.attention ? 3 : glyphState(e) === "working" ? 2 : 0),
  className: (e) => `glyphview agent g-${glyphState(e)}`,
  render(e) {
    const d = /** @type {Record<string, any>} */ (e.data);
    const run = currentRun(e);
    const said = /** @type {string | null | undefined} */ (run?.data.lastText);
    const runs = /** @type {{ sessionId: string, cause: string, at: number }[]} */ (d.runs ?? []);
    return `
      <div class="ui" style="left:16px;top:80px">
        <span class="glyph" data-dot><i class="moon"></i></span>
        <div class="lab"><span class="lab-t">${esc(e.title)}</span></div>
        <div class="bub">
          ${said && glyphState(e) !== "working" ? `<div class="b-said md">${renderMarkdown(said)}</div>` : ""}
          <div class="b-meta">${esc(d.role)}</div>
          <div class="b-meta ${d.understood ? "" : "b-warn"}">${esc(d.reading)}</div>
          ${runs.length ? `<div class="b-deep">${runs.slice(0, 3).map((r) => `${esc(ago(r.at))}: ${esc(r.cause)}`).join("<br>")}</div>` : ""}
          ${permissionRow(run)}
          <div class="b-btns b-act">${e.status === "running" ? `<span class="b-meta">Running …</span>` : `<button class="btn quiet" data-action="agents.run" ${inputAttr({ id: d.id })}>Run now</button>`}</div>
        </div>
      </div>`;
  },
});
