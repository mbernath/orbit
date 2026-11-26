// Canvas store: elements place entities on the canvas (ADR-0008).
// An entity without a row is an implicit element; a row is written once the user changes something.
import type { Database } from "bun:sqlite";
import type { ActionDefinition, CoreEvent, Element, Migration } from "./types";

export const canvasMigrations: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE elements (
          id TEXT PRIMARY KEY, ref TEXT NOT NULL, view TEXT,
          x REAL, y REAL, w REAL, h REAL, z INTEGER NOT NULL DEFAULT 0,
          parent TEXT, state TEXT NOT NULL DEFAULT '{}',
          archived_at INTEGER, updated_at INTEGER NOT NULL
        );
        CREATE INDEX elements_ref ON elements (ref);
      `);
    },
  },
];

type Row = {
  id: string; ref: string; view: string | null; x: number | null; y: number | null; w: number | null; h: number | null;
  z: number; parent: string | null; state: string; archived_at: number | null; updated_at: number;
};

const toElement = (r: Row): Element => ({
  id: r.id, ref: r.ref, view: r.view, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z, parent: r.parent,
  state: JSON.parse(r.state || "{}"), archived: r.archived_at != null, updatedAt: r.updated_at,
});

type Box = { x: number; y: number; w: number; h: number };
type FrameBox = Box & { ws: string };
/** Either one frame inline ({ ws, x, y, w, h }) or several ({ frames: [...] }), plus optional element moves. */
type FrameInput = Partial<FrameBox> & { frames?: FrameBox[]; moves?: { ref: string; x: number; y: number }[] };
const framesOf = (i: FrameInput): FrameBox[] => (Array.isArray(i?.frames) ? i.frames : i && "ws" in i ? [i as FrameBox] : []);

/** Same rule as the board (web/js/frames.js): frames keep a gap of FRAME_GAP world units. */
export const FRAME_GAP = 28;
export const FRAME_MIN = { w: 220, h: 160 };
export const frameId = (ws: string) => `frame:${ws}`;
export const framesOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w + FRAME_GAP && b.x < a.x + a.w + FRAME_GAP && a.y < b.y + b.h + FRAME_GAP && b.y < a.y + a.h + FRAME_GAP;

const isRefList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

export function createCanvas(db: Database, notify: (e: CoreEvent) => void) {
  // The primary element of an entity has the ref as id; further elements (other views) get their own ids.
  const ensure = db.prepare(
    `INSERT INTO elements (id, ref, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  );

  const list = () => (db.query(`SELECT * FROM elements`).all() as Row[]).map(toElement);

  function unarchive(ref: string) {
    db.run(`UPDATE elements SET archived_at = NULL, updated_at = ? WHERE ref = ? AND archived_at IS NOT NULL`, [Date.now(), ref]);
  }

  const actions: ActionDefinition[] = [
    {
      id: "canvas.place",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { ref?: unknown; x?: unknown; y?: unknown }) =>
        typeof i?.ref === "string" && Number.isFinite(i.x) && Number.isFinite(i.y) ? null : "Invalid position.",
      run(i: { ref: string; id?: string; x: number; y: number }) {
        const id = i.id ?? i.ref;
        const now = Date.now();
        ensure.run(id, i.ref, now);
        db.run(`UPDATE elements SET x = ?, y = ?, updated_at = ? WHERE id = ?`, [i.x, i.y, now, id]);
        return { ok: true };
      },
    },
    {
      id: "canvas.unplace",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { refs?: unknown }) => (isRefList(i?.refs) ? null : "No elements given."),
      run(i: { refs: string[] }) {
        const stmt = db.prepare(`UPDATE elements SET x = NULL, y = NULL, updated_at = ? WHERE ref = ?`);
        for (const ref of i.refs) stmt.run(Date.now(), ref);
        return { ok: true };
      },
    },
    {
      id: "canvas.archive",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: { refs?: unknown; archived?: unknown }) =>
        isRefList(i?.refs) && typeof i.archived === "boolean" ? null : "Invalid input.",
      run(i: { refs: string[]; archived: boolean }) {
        const now = Date.now();
        db.transaction(() => {
          for (const ref of i.refs) {
            ensure.run(ref, ref, now);
            db.run(`UPDATE elements SET archived_at = ?, updated_at = ? WHERE id = ?`, [i.archived ? now : null, now, ref]);
          }
        })();
        if (i.archived) for (const ref of i.refs) notify({ type: "element.archived", ref });
        return { ok: true };
      },
    },
    {
      // An island is a frame element `frame:<workspace id>` with x, y, w, h (ADR-0012). Frames never overlap.
      // One call may set several frames (the board pins all islands where they are shown the first time the user
      // changes one) and move the placed elements inside — all in one transaction, so nothing is half saved.
      id: "canvas.frame",
      risk: "local",
      allowedActors: ["board"],
      validate: (i: FrameInput) => {
        const batch = framesOf(i);
        if (!batch.length) return "No island given.";
        for (const f of batch) {
          if (typeof f?.ws !== "string" || !f.ws) return "No island given.";
          if (![f.x, f.y, f.w, f.h].every(Number.isFinite) || f.w < FRAME_MIN.w || f.h < FRAME_MIN.h) return "Invalid size.";
        }
        if (i.moves !== undefined && !(Array.isArray(i.moves) && i.moves.every((m) => typeof m?.ref === "string" && Number.isFinite(m.x) && Number.isFinite(m.y))))
          return "Invalid move.";
        const ids = new Set(batch.map((f) => frameId(f.ws)));
        const others = list().filter((e) => e.id.startsWith("frame:") && !ids.has(e.id) && e.x != null && e.y != null && e.w != null && e.h != null) as unknown as Box[];
        const all = [...batch, ...others];
        if (batch.some((f) => all.some((o) => o !== f && framesOverlap(f, o)))) return "Islands must not overlap.";
        return null;
      },
      run(i: FrameInput) {
        const now = Date.now();
        db.transaction(() => {
          for (const f of framesOf(i)) {
            const id = frameId(f.ws);
            ensure.run(id, `frame:core/${f.ws}`, now);
            db.run(`UPDATE elements SET x = ?, y = ?, w = ?, h = ?, updated_at = ? WHERE id = ?`, [f.x, f.y, f.w, f.h, now, id]);
          }
          for (const m of i.moves ?? []) {
            ensure.run(m.ref, m.ref, now);
            db.run(`UPDATE elements SET x = ?, y = ?, updated_at = ? WHERE id = ?`, [m.x, m.y, now, m.ref]);
          }
        })();
        return { ok: true };
      },
    },
  ];

  return { list, unarchive, actions };
}
