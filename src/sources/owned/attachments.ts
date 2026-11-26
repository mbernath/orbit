// Attachments in messages to owned sessions (ADR-0021): images go inline as content blocks, every other file is stored
// under ~/.orbit/attachments/<session>/ and named to Claude by its path.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export type Attachment = { name: string; type: string; data: string }; // data: base64
export type Image = { mediaType: string; data: string };

export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Problem text, or null when the attachments are acceptable. */
export function checkAttachments(x: unknown): string | null {
  if (x == null) return null;
  if (!Array.isArray(x)) return "Invalid attachments.";
  if (x.length > MAX_FILES) return `At most ${MAX_FILES} files.`;
  for (const a of x) {
    if (!a || typeof a.name !== "string" || typeof a.type !== "string" || typeof a.data !== "string") return "Invalid attachments.";
    if (a.data.length * 0.75 > MAX_BYTES) return `“${a.name}” is larger than 10 MB.`;
  }
  return null;
}

/** A file name that stays inside its folder: no path parts, no hidden files, nothing empty. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^\w.\- äöüÄÖÜß]/g, "_").replace(/^\.+/, "").trim();
  return clean.slice(0, 120) || "attachment";
}

/** Splits attachments: images inline, the rest written to disk; returns the text lines naming the stored files. */
export function prepareAttachments(home: string, sessionId: string, list: Attachment[] = []): { images: Image[]; lines: string[] } {
  const images: Image[] = [];
  const lines: string[] = [];
  for (const a of list) {
    if (IMAGE_TYPES.has(a.type)) {
      images.push({ mediaType: a.type, data: a.data });
      continue;
    }
    const dir = join(home, "attachments", sessionId);
    mkdirSync(dir, { recursive: true });
    const name = safeName(a.name);
    let path = join(dir, name);
    for (let n = 2; existsSync(path); n++) path = join(dir, `${name.slice(0, name.length - extname(name).length)}-${n}${extname(name)}`);
    writeFileSync(path, Buffer.from(a.data, "base64"));
    lines.push(`Attached file: ${path}`);
  }
  return { images, lines };
}
