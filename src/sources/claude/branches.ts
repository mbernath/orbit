// Branches a session worked on itself (ADR-0024): created, pushed, or opened a PR for. In the shared main checkout only
// these link a session to a PR — the checkout's current branch is shared by every session there.
import { existsSync, readFileSync } from "node:fs";

/** Branches a shell command creates, pushes or opens a PR for. `current` is the checkout's branch at that moment. */
export function branchesOf(command: string, current: string | null): string[] {
  const out: string[] = [];
  // one command line may chain several commands
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const c = part.trim();
    let m: RegExpMatchArray | null;
    if ((m = c.match(/\bgit\s+(?:checkout|switch)\b.*?\s-[bcBC]\s+([^\s]+)/))) out.push(m[1]!);
    else if ((m = c.match(/\bgit\s+worktree\s+add\b.*?\s-[bB]\s+([^\s]+)/))) out.push(m[1]!);
    else if (/\bgit\s+push\b/.test(c)) {
      const args = c.replace(/.*\bgit\s+push\b/, "").split(/\s+/).filter((a) => a && !a.startsWith("-"));
      // git push [remote] [refspec…]; without a refspec it pushes the current branch
      const refs = args.slice(1).map((r) => r.replace(/^\+/, "").split(":").pop() ?? "");
      if (refs.length) out.push(...refs.filter((r) => r && r !== "HEAD"));
      else if (current) out.push(current);
    } else if (/\bgh\s+pr\s+create\b/.test(c)) {
      m = c.match(/--head[=\s]+([^\s"']+)/);
      if (m) out.push(m[1]!);
      else if (current) out.push(current);
    }
  }
  return out;
}

/** All branches a transcript's Bash calls worked on, oldest first, without duplicates. Read only (ADR-0003). */
export function ownBranches(path: string | null | undefined): string[] {
  if (!path || !existsSync(path)) return [];
  const found: string[] = [];
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes('"Bash"')) continue; // cheap filter: only lines with a Bash tool call
      let e: any;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
      for (const b of e.message.content) {
        if (b?.type === "tool_use" && b.name === "Bash" && typeof b.input?.command === "string") {
          for (const br of branchesOf(b.input.command, typeof e.gitBranch === "string" ? e.gitBranch : null))
            if (!found.includes(br)) found.push(br);
        }
      }
    }
  } catch {}
  return found;
}
