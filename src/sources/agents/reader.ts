// Reads a free-text trigger once into a rule (ADR-0016): one short `claude -p` call with a small model, no tools,
// with the user's own login (ADR-0019). The answer is validated against the schema; anything else is "not understood".
import type { Runner } from "../../core/types";
import { EVENT_TYPES, parseRule, type Rule } from "./rules";

const PROMPT = (text: string) => `Read a trigger for an agent and return it as JSON, nothing else. The trigger may be written in any language.
Schema, exactly one of these forms:
{"kind":"manual"}
{"kind":"event","type":<${EVENT_TYPES.map((t) => `"${t}"`).join("|")}>,"repo"?:"owner/name","branch"?:"<branch or pattern with *>","path"?:"<path pattern relative to the folder, ** allowed>"}
{"kind":"schedule","schedule":{"every":"day"|"weekday","at":"HH:MM"}}
{"kind":"schedule","schedule":{"every":"week","at":"HH:MM","weekday":1-7}}   (1 = Monday)
{"kind":"schedule","schedule":{"every":"hours","hours":<1-168>}}
For "pr.merged", "branch" is the target branch ("after every merge into main" → "branch":"main").
If the text does not fit the schema, return {"understood":false}.
Trigger: ${JSON.stringify(text)}`;

/** The claude call; `env -u` keeps an API key in Orbit's environment away from it (ADR-0019). */
export const readerCommand = (bin: string, text: string) => [
  "env", "-u", "ANTHROPIC_API_KEY", "-u", "ANTHROPIC_AUTH_TOKEN",
  bin, "-p", "--model", "haiku", "--output-format", "json", "--tools", "", PROMPT(text),
];

/** @returns the rule, or null when the text was not understood or the call failed (then: manual only) */
export async function readTrigger(run: Runner, bin: string, text: string, cwd?: string): Promise<{ rule: Rule | null; error: string | null }> {
  if (!text.trim()) return { rule: { kind: "manual" }, error: null };
  const r = await run(readerCommand(bin, text), cwd);
  if (r.code !== 0) return { rule: null, error: `Couldn't reach Claude Code (code ${r.code}).` };
  try {
    const answer = String(JSON.parse(r.stdout).result ?? "");
    const json = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1); // tolerate code fences or a stray word
    return { rule: parseRule(JSON.parse(json)), error: null };
  } catch {
    return { rule: null, error: null };
  }
}
