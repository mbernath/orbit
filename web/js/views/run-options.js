// @ts-check
// How an owned session runs (ADR-0017, ADR-0019): model, thinking effort and permission mode, as [value, label].
// "" leaves the value open: the island's default applies (ADR-0025), and the option shows that value instead of
// "Default". One place for the panel, the "New session" form and the island's defaults; the server validates.
import { esc } from "../util.js";

// Short values, no captions, so all three fit in one line; the select's aria-label and title name what it chooses.
export const MODELS = [["", "Default"], ["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]];
export const EFFORTS = [["", "Default"], ["low", "low"], ["medium", "medium"], ["high", "high"]];
/** never bypassPermissions (ADR-0019); "" without a known default is the CLI's own, which asks */
export const MODES = [["", "Ask first"], ["acceptEdits", "Accept edits"], ["auto", "Auto"], ["plan", "Plan mode"]];

/** @typedef {{ model?: string | null, effort?: string | null, mode?: string | null }} RunValues */

/**
 * Label of a raw value from Claude's settings or the CLI ("opus[1m]", "claude-haiku-4-5", "medium", "default").
 * @param {string[][]} options @param {string | null | undefined} raw
 */
export function labelOf(options, raw) {
  if (!raw) return null;
  if (raw === "default") return "Ask first";
  const hit = options.find(([v]) => v && (v === raw || (options === MODELS && raw.includes(v))));
  return hit?.[1] ?? raw;
}

/** @param {string} name @param {string[][]} options @param {string | null | undefined} value @param {string} label @param {string} [attr] */
export const optionSelect = (name, options, value, label, attr = "name") =>
  `<select ${attr}="${name}" aria-label="${label}" title="${label}">${options.map(([v, t]) => `<option value="${v}" ${v === (value ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;

/**
 * The one line of model, thinking and mode. An open value ("") reads as the default that applies.
 * @param {RunValues} chosen @param {RunValues} defaults @param {string} [attr] @param {(label: string) => string} [open] text of the open option
 */
export function runSelects(chosen, defaults, attr = "name", open = (l) => l) {
  /** @param {string[][]} options @param {string | null | undefined} raw */
  const withDefault = (options, raw) => [["", open(labelOf(options, raw) ?? options[0]?.[1] ?? "")], ...options.slice(1)];
  return `<div class="p-run">${optionSelect("model", withDefault(MODELS, defaults.model), chosen.model, "Model", attr)}${optionSelect("effort", withDefault(EFFORTS, defaults.effort), chosen.effort, "Effort", attr)}${optionSelect("mode", withDefault(MODES, defaults.mode), chosen.mode, "Mode", attr)}</div>`;
}
