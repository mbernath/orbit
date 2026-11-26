// The action layer (ADR-0009): every write runs through `execute`, is checked and logged.
import type { ActionDefinition, ActionResult, Actor } from "./types";

/** The event log keeps what happened, not file contents: long strings (e.g. base64 attachments, ADR-0021) are cut. */
export function shorten(x: unknown): unknown {
  if (typeof x === "string") return x.length > 2000 ? `${x.slice(0, 200)}… [${x.length} characters]` : x;
  if (Array.isArray(x)) return x.map(shorten);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shorten(v)]));
  return x;
}

export function createActions(log: (type: string, payload: unknown) => void) {
  const registry = new Map<string, ActionDefinition>();

  function register(defs: ActionDefinition[] = []) {
    for (const d of defs) {
      if (registry.has(d.id)) throw new Error(`Action ${d.id} registered twice`);
      registry.set(d.id, d);
    }
  }

  async function execute(id: string, input: unknown, actor: Actor, confirmed = false): Promise<ActionResult> {
    const def = registry.get(id);
    if (!def) return { ok: false, status: 404, error: "Unknown action." };
    if (!def.allowedActors.includes(actor)) return { ok: false, status: 403, error: "Action not allowed." };
    // The system may start work, never act outward or irreversibly on its own (ADR-0009, ADR-0020).
    if (actor === "system" && def.risk !== "local") return { ok: false, status: 403, error: "Only you can trigger this." };
    // Outward and irreversible actions need an explicit confirmation from the board.
    if (def.risk !== "local" && !confirmed) return { ok: false, status: 428, error: "Confirmation required." };
    const problem = def.validate?.(input ?? {}) ?? null;
    if (problem) return { ok: false, status: 400, error: problem };
    let result: ActionResult;
    try {
      result = await def.run(input ?? {});
    } catch (err) {
      result = { ok: false, status: 500, error: String(err) };
    }
    log("action", { id, actor, risk: def.risk, input: shorten(input), ok: result.ok, error: result.ok ? undefined : result.error });
    return result;
  }

  return { register, execute, has: (id: string) => registry.has(id) };
}
