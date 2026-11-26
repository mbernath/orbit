// @ts-check
// YAML frontmatter at the top of a Markdown text (ADR-0029 amendment). Pure: split it off, read flat key/value pairs.
// No YAML parser: "key: value" lines and "key:" followed by "- item" lines are read; anything else stays raw text.

/** @typedef {{ body: string, raw: string | null, fields: [string, string][] | null }} Frontmatter */

// Only a "---" on the very first line opens frontmatter; it closes with "---" or "..." on a line of its own.
const BLOCK = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const PAIR = /^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const ITEM = /^[ \t]+-[ \t]+(.*)$/;

/** @param {string} v */
const unquote = (v) => {
  const s = v.trim();
  return /^(["']).*\1$/.test(s) && s.length >= 2 ? s.slice(1, -1) : s;
};

/**
 * @param {string} raw the lines between the fences
 * @returns {[string, string][] | null} null when the block is not flat enough to show as a table
 */
function readFields(raw) {
  /** @type {[string, string][]} */
  const fields = [];
  /** @type {string[] | null} */
  let items = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(ITEM);
    if (item && items) {
      items.push(unquote(item[1] ?? ""));
      const last = fields[fields.length - 1];
      if (last) last[1] = items.join(", ");
      continue;
    }
    const pair = line.match(PAIR);
    if (!pair) return null;
    const value = pair[2]?.trim() ?? "";
    if (/^[|>{[]/.test(value) && !/^\[.*\]$/.test(value)) return null; // block scalars and multi-line flow values
    const list = value.match(/^\[(.*)\]$/);
    fields.push([pair[1] ?? "", list ? (list[1] ?? "").split(",").map(unquote).filter(Boolean).join(", ") : unquote(value)]);
    items = value ? null : [];
  }
  return fields.length ? fields : null;
}

/**
 * @param {string} text
 * @returns {Frontmatter} body: the text without the block; raw: the block's content or null if there is none
 */
export function splitFrontmatter(text) {
  const m = text.match(BLOCK);
  if (!m) return { body: text, raw: null, fields: null };
  const raw = m[1] ?? "";
  return { body: text.slice(m[0].length), raw, fields: readFields(raw) };
}
