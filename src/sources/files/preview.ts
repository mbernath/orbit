// The preview's file bytes (ADR-0040): which files it may serve, and as what.
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Workspace } from "../../core/types";
import { json } from "../../core/util";
import { locateReference } from "./open";

/** GET /api/files/raw?path=&base= — the file, or 4xx with an error; 415 carries name and size for "no preview". */
export function servePreview(q: URLSearchParams, workspaces: Workspace[]): Response {
  const path = q.get("path");
  if (!path) return json({ error: "Path missing." }, 400);
  const c = locateReference(path, q.get("base"), workspaces);
  if (!c.ok) return json({ error: c.error }, c.error === "File not found." ? 404 : 400);
  const st = statSync(c.path);
  const type = st.isFile() ? previewType(c.path) : null;
  const meta = { path: c.path, name: basename(c.path), size: st.size, folder: st.isDirectory() };
  if (!type) return json({ ...meta, error: "No preview for this file type." }, 415);
  if (st.size > PREVIEW_MAX_BYTES) return json({ ...meta, error: "Too large to preview." }, 415);
  return new Response(readFileSync(c.path), {
    headers: {
      "Content-Type": type,
      "X-Orbit-Path": encodeURIComponent(c.path),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    },
  });
}

export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

const BINARY: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml", // shown through <img>, so scripts inside never run
  ".pdf": "application/pdf",
};

/** Text shown as code; HTML is left out on purpose (it opens in the browser instead). */
const TEXT = new Set(
  (
    ".txt .log .csv .tsv .json .jsonc .yaml .yml .toml .ini .env.example .xml .sql .graphql " +
    ".ts .tsx .js .jsx .mjs .cjs .css .scss .py .rb .go .rs .java .kt .swift .c .h .cpp .hpp .cs .php .lua .sh .bash .zsh .fish .r .ex .exs"
  ).split(" "),
);
const TEXT_NAMES = new Set(["Makefile", "Dockerfile", "LICENSE", ".gitignore", ".editorconfig"]);

/** The Content-Type the preview serves `path` as, or null if it shows no preview for it. */
export function previewType(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (BINARY[ext]) return BINARY[ext];
  if (ext === ".md" || ext === ".markdown") return "text/markdown; charset=utf-8";
  const name = path.split("/").at(-1) ?? "";
  if (TEXT.has(ext) || TEXT_NAMES.has(name)) return "text/plain; charset=utf-8";
  return null;
}
