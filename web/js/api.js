// @ts-check
// The only module that talks to the server.
/** @typedef {import("../../src/core/types").StateResponse} StateResponse */

const token = document.querySelector('meta[name="orbit-token"]')?.getAttribute("content") ?? "";

/** @type {(text: string) => void} */
let onError = () => {};
/** @param {(text: string) => void} fn */
export const setErrorHandler = (fn) => void (onError = fn);

/** @returns {Promise<StateResponse>} */
export async function loadState() {
  const res = await fetch("/api/state");
  return res.json();
}

/** Markdown files that can be pinned (ADR-0011). @returns {Promise<{ workspaceId: string, path: string, rel: string }[]>} */
export async function loadFileCandidates() {
  const res = await fetch("/api/files/candidates");
  return res.ok ? res.json() : [];
}

/** The guide for list scripts (ADR-0036, docs/list-contract.md) as Markdown, or null. @returns {Promise<string | null>} */
export async function loadListGuide() {
  const res = await fetch("/api/lists/guide");
  return res.ok ? res.text() : null;
}

/** The end of a session's conversation (detail panel). @param {string} id
 * @returns {Promise<{ role: "you" | "ai" | "tool" | "note", text: string, at: number | null }[]>} */
export async function loadConversation(id) {
  const res = await fetch(`/api/conversation?id=${encodeURIComponent(id)}`);
  return res.ok ? res.json() : [];
}

/** Hook events the installed Orbit hook lacks (ADR-0031), and whether it is installed at all (ADR-0041).
 * Unreachable counts as installed: no notice from a failed request. @returns {Promise<import("../../src/core/types").HookCheck>} */
export async function loadHookCheck() {
  const res = await fetch("/api/claude/hooks").catch(() => null);
  return res?.ok ? res.json() : { missing: [], installed: true };
}

/** Folders Claude Code was used in that are no island yet (ADR-0041). @returns {Promise<import("../../src/core/types").FolderSuggestion[]>} */
export async function loadFolders() {
  const res = await fetch("/api/claude/folders").catch(() => null);
  return res?.ok ? res.json() : [];
}

/**
 * Runs an action through the action layer (ADR-0009).
 * @param {string} id
 * @param {Record<string, unknown>} [input]
 * @param {{ confirm?: boolean, quiet?: boolean }} [opts] quiet: the caller shows the error itself
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: string }>}
 */
export async function runAction(id, input = {}, opts = {}) {
  let error;
  try {
    const res = await fetch(`/api/actions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Orbit-Token": token },
      body: JSON.stringify({ input, confirm: opts.confirm === true }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: body.data };
    error =
      res.status === 401
        ? "The Orbit server has restarted. Reload the page."
        : res.status === 404 && !body.error
          ? "The Orbit server runs an older version. Restart it."
          : body.error || `Error (HTTP ${res.status}).`;
  } catch {
    error = "Orbit server not reachable.";
  }
  if (!opts.quiet) onError(error);
  return { ok: false, error };
}

/**
 * Subscribes to server changes (SSE, ADR-0007). EventSource reconnects on its own.
 * @param {() => void} onChange
 */
export function subscribe(onChange) {
  const source = new EventSource("/api/stream");
  source.addEventListener("change", onChange);
  return () => source.close();
}

/**
 * A file's bytes for the preview (ADR-0040), resolved like files.open. With the token header, so the URL carries none.
 * @param {string} path @param {string | null | undefined} base
 * @returns {Promise<{ ok: true, path: string, type: string, blob: Blob } | { ok: false, status: number, path: string | null, size: number | null, folder: boolean, error: string }>}
 */
export async function loadFilePreview(path, base) {
  const q = new URLSearchParams({ path, ...(base ? { base } : {}) });
  try {
    const res = await fetch(`/api/files/raw?${q}`, { headers: { "X-Orbit-Token": token } });
    if (res.ok) {
      const resolved = decodeURIComponent(res.headers.get("X-Orbit-Path") ?? path);
      return { ok: true, path: resolved, type: res.headers.get("Content-Type") ?? "", blob: await res.blob() };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, path: body.path ?? null, size: body.size ?? null, folder: body.folder === true, error: body.error || `Error (HTTP ${res.status}).` };
  } catch {
    return { ok: false, status: 0, path: null, size: null, folder: false, error: "Orbit server not reachable." };
  }
}
