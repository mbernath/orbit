import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expandHome, hasTitleMarker, isWithinPath, oneLine, splitTitle, truncate } from "../../core/util";
import { systemNote, todoNote, toolLine } from "./entries";

// Summary of a Claude Code transcript (~/.claude/projects/<dir>/<session>.jsonl).
export type TranscriptInfo = {
  id: string;
  cwd: string;
  branch: string | null;
  firstPrompt: string;
  aiTitle: string | null;
  lastMessage: string | null;
  startedAt: number;
  updatedAt: number;
};

// Claude Code names project dirs after the cwd with every non-alphanumeric char replaced by "-".
export const encodeProjectDir = (p: string) => p.replace(/[^a-zA-Z0-9]/g, "-");

// Lists transcript files whose project dir could belong to one of the given paths.
// The encoding is lossy, so callers must still check the real cwd.
export function findTranscripts(projectsDir: string, paths: string[]): string[] {
  if (!existsSync(projectsDir)) return [];
  const prefixes = paths.map((p) => encodeProjectDir(expandHome(p)));
  const files: string[] = [];
  for (const dir of readdirSync(projectsDir)) {
    if (!prefixes.some((pre) => dir === pre || dir.startsWith(pre + "-"))) continue;
    const full = join(projectsDir, dir);
    try {
      for (const f of readdirSync(full)) if (f.endsWith(".jsonl")) files.push(join(full, f));
    } catch {}
  }
  return files;
}

export function isWithin(cwd: string, paths: string[]) {
  return paths.some((raw) => isWithinPath(cwd, expandHome(raw)));
}

export function parseTranscript(file: string): TranscriptInfo | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let id: string | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let aiTitle: string | null = null;
  let ownTitle: string | null = null; // "[Title: …]" a session Orbit started opened with (ADR-0032)
  let firstPrompt: string | null = null;
  let lastMessage: string | null = null;
  let first = Infinity;
  let last = 0;

  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // unknown or truncated line
    }
    if (e.isSidechain) continue;
    if (typeof e.sessionId === "string") id ??= e.sessionId;
    const t = titleOf(e);
    if (t) aiTitle = t;
    if (e.type !== "user" && e.type !== "assistant") continue;
    if (typeof e.cwd === "string") cwd ??= e.cwd;
    if (typeof e.gitBranch === "string" && e.gitBranch && e.gitBranch !== "HEAD") branch = e.gitBranch;
    const ts = Date.parse(e.timestamp);
    if (!Number.isNaN(ts)) {
      first = Math.min(first, ts);
      last = Math.max(last, ts);
    }
    if (e.type === "user" && !firstPrompt && !e.isMeta) firstPrompt = promptText(e.message?.content);
    if (e.type === "assistant") {
      const { title, rest } = splitTitle(assistantText(e.message?.content));
      ownTitle ??= title;
      lastMessage = rest || lastMessage;
    }
  }

  if (!id || !cwd || !firstPrompt) return null; // empty or foreign file
  aiTitle ??= ownTitle; // Claude Code's own topic title wins
  const mtime = statSync(file).mtimeMs;
  return {
    id,
    cwd,
    branch,
    firstPrompt: truncate(oneLine(firstPrompt), 90),
    aiTitle: aiTitle ? truncate(oneLine(aiTitle), 90) : null,
    lastMessage: lastMessage ? truncate(lastMessage.trim(), 500) : null,
    startedAt: Number.isFinite(first) ? first : mtime,
    updatedAt: last || mtime,
  };
}

// Topic title Claude Code writes into the transcript ("ai-title"); a rename inside
// Claude Code ("custom-title") counts as well. Older versions wrote "summary".
function titleOf(e: any): string | null {
  const t =
    e?.type === "custom-title" ? e.customTitle
    : e?.type === "ai-title" ? e.aiTitle
    : e?.type === "summary" ? e.summary
    : null;
  return typeof t === "string" && t.trim() ? t : null;
}

// Latest topic title of a transcript; without one, the "[Title: …]" the first reply opened with (ADR-0032).
// Only candidate lines are parsed, so large files stay cheap.
export function readAiTitle(path?: string | null): string | null {
  if (!path || !existsSync(path)) return null;
  let title: string | null = null;
  let own: string | null = null;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const marker = !own && hasTitleMarker(line);
      if (!marker && !line.includes("-title\"") && !line.includes("\"summary\"")) continue;
      try {
        const e = JSON.parse(line);
        title = titleOf(e) ?? title;
        if (marker && e.type === "assistant" && !e.isSidechain) own = splitTitle(assistantText(e.message?.content)).title;
      } catch {}
    }
  } catch {}
  title ??= own;
  return title ? truncate(oneLine(title), 90) : null;
}

/** Text of a user message without IDE context and system reminders; slash-command wrappers kept. */
function userText(content: unknown): string {
  const parts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.filter((b: any) => b?.type === "text").map((b: any) => String(b.text))
        : [];
  return parts
    .map((p) => p.replace(/<(ide_[\w-]+|system-reminder)>[\s\S]*?<\/\1>/g, ""))
    .join(" ")
    .trim();
}

function promptText(content: unknown): string | null {
  // Drop slash-command wrappers too, keep what the user typed.
  const text = userText(content).replace(/<(command-[\w-]+|local-command-[\w-]+)>[\s\S]*?<\/\1>/g, "").trim();
  return text || null;
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
}

/** Last assistant text of a transcript, for Stop events that do not carry it. */
export function lastAssistantText(path?: string): string | null {
  if (!path || !existsSync(path)) return null;
  try {
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 300); i--) {
      const entry = JSON.parse(lines[i]!);
      if (entry.type !== "assistant") continue;
      const text = splitTitle(assistantText(entry.message?.content)).rest.trim();
      if (text) return text;
    }
  } catch {}
  return null;
}


/** One entry of a conversation as the detail panel shows it. */
export type ConversationEntry = { role: "you" | "ai" | "tool" | "note"; text: string; at: number | null };

/**
 * The last `limit` entries of a conversation: the user's prompts, Claude's texts and one line per tool call.
 * Reads only the tail of the file (read-only, ADR-0003); tool results and IDE context are left out.
 */
export function readConversation(path: string | null | undefined, limit = 60): ConversationEntry[] {
  if (!path || !existsSync(path)) return [];
  const out: ConversationEntry[] = [];
  try {
    const lines = readFileSync(path, "utf8").trimEnd().split("\n").slice(-3000);
    for (const line of lines) {
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const at = e.timestamp ? Date.parse(e.timestamp) : null;
      if (e.type === "user" && e.isCompactSummary) {
        out.push({ role: "note", text: "Context compacted", at });
      } else if (e.type === "user" && !e.isMeta) {
        const raw = userText(e.message?.content);
        const note = raw ? systemNote(raw) : null;
        if (note) out.push({ role: "note", text: note, at });
        else if (raw) out.push({ role: "you", text: truncate(raw, 4000), at });
      } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
        for (const b of e.message.content) {
          const text = b?.type === "text" ? splitTitle(String(b.text)).rest.trim() : "";
          if (text) out.push({ role: "ai", text: truncate(text, 8000), at });
          else if (b?.type === "text") continue; // empty text block
          else if (b?.type === "tool_use" && b.name === "TodoWrite" && todoNote(b.input)) out.push({ role: "note", text: todoNote(b.input)!, at });
          else if (b?.type === "tool_use") out.push({ role: "tool", text: toolLine(b), at });
        }
      }
    }
  } catch {}
  return out.slice(-limit);
}
