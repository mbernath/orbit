// @ts-check
// Board state: server data plus per-browser UI state, with derived lookups.
/** @typedef {import("../../src/core/types").ResolvedEntity} Entity */
/** @typedef {import("../../src/core/types").Element} CanvasElement */
/** @typedef {import("../../src/core/types").Workspace} Workspace */

/** Island for entities that belong to no workspace. */
export const NO_WS = "__none__";

export const store = {
  /** @type {Workspace[]} */ workspaces: [],
  /** @type {Entity[]} */ entities: [],
  /** @type {Map<string, Entity>} */ byRef: new Map(),
  /** @type {Map<string, CanvasElement>} */ elements: new Map(), // by element id (= ref for primary elements, frame:<ws> for islands)

  /** @param {import("../../src/core/types").StateResponse} s */
  load(s) {
    this.workspaces = s.workspaces;
    this.entities = s.entities;
    this.byRef = new Map(s.entities.map((e) => [e.ref, e]));
    this.elements = new Map(s.elements.map((e) => [e.id, e]));
  },

  /** @param {string} id */
  workspaceName(id) {
    return id === NO_WS ? "No island" : this.workspaces.find((w) => w.id === id)?.name ?? id;
  },

  /** @param {Entity} e */
  islandOf: (e) => e.workspaceId ?? NO_WS,

  /** @param {string} ref */
  isArchived(ref) {
    return this.elements.get(ref)?.archived ?? false;
  },

  /** Islands in workspace order; "No island" last when something lives there. */
  islands() {
    const ids = this.workspaces.map((w) => w.id);
    if (this.entities.some((e) => !e.workspaceId && e.kind === "session")) ids.push(NO_WS);
    return ids;
  },

  /** Whether the element has a stored position — only ever from dragging that element (ADR-0012). @param {string} ref */
  placed(ref) {
    const el = this.elements.get(ref);
    return !!el && el.x != null && el.y != null;
  },

  /** Frames the user has sized or moved (stored as elements frame:<island>). @returns {Map<string, {x:number,y:number,w:number,h:number}>} */
  storedFrames() {
    /** @type {Map<string, {x:number,y:number,w:number,h:number}>} */
    const out = new Map();
    for (const el of this.elements.values()) {
      if (!el.id.startsWith("frame:") || el.x == null || el.y == null || el.w == null || el.h == null) continue;
      out.set(el.id.slice(6), { x: el.x, y: el.y, w: el.w, h: el.h });
    }
    return out;
  },

  /** Entities linked to `e` through shared keys, optionally of one kind. @param {Entity} e @param {string} [kind] */
  related(e, kind) {
    return e.related.map((r) => this.byRef.get(r)).filter(/** @returns {x is Entity} */ (x) => !!x && (!kind || x.kind === kind));
  },

  /** A session that is a run of an agent: shown inside its agent, not as a dot of its own (ADR-0015). @param {Entity} e */
  isRun(e) {
    return e.kind === "session" && this.related(e, "control").some((c) => !!(/** @type {any} */ (c.data).agent));
  },
};
