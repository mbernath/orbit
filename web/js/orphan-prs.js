// @ts-check
// PRs as a stack (ADR-0038): an island's PRs without a session, and a session's own PRs, both show their first PR
// as a chip; more PRs lie as an offset box behind it, and a click then lists them all instead of opening GitHub.
// Pure: no DOM, no store; unit-tested in test/orphan-prs.test.ts. render.js and views/pr.js draw it (pr-stack.js).

/** @typedef {import("../../src/core/types").ResolvedEntity} Entity */
/** @typedef {{ pr: Entity, label: string, level: string, mine: boolean, url: string, hint: string }} Pill */

const RANK = /** @type {Record<string, number>} */ ({ fail: 0, ready: 1, review: 2 });

/**
 * Orphans: open PRs of an island that no session on the board shows and that need the user, most urgent first.
 * @param {Entity[]} prs the island's PR entities
 * @param {(pr: Entity) => boolean} shownAtSession whether a session on the board shows this PR
 * @returns {Pill[]}
 */
export function orphanPrs(prs, shownAtSession) {
  return prs
    .filter((pr) => pr.status !== "merged" && pr.attention && pr.attention.level in RANK && !shownAtSession(pr))
    .sort((a, b) => rank(a) - rank(b) || num(a) - num(b))
    .map((pr) => {
      const d = /** @type {Record<string, any>} */ (pr.data);
      return { pr, label: `#${d.number}`, level: prLevel(pr), mine: d.mine !== false, url: String(d.url), hint: `${prWord(pr)} · ${pr.title}` };
    });
}

/**
 * The PRs a session shows when its branches led to several: the open ones, most urgent first (as at the island),
 * then newest; when none is open, only the newest merged one. The first is the one its chip, PR row and merge
 * button act on.
 * @param {Entity[]} prs the PRs linked to one session
 * @returns {Entity[]}
 */
export function sessionPrs(prs) {
  const byNewest = [...prs].sort((a, b) => num(b) - num(a));
  const open = byNewest.filter((p) => p.status !== "merged").sort((a, b) => rank(a) - rank(b));
  return open.length ? open : byNewest.slice(0, 1);
}

/** @param {Entity[]} prs */
export const sessionPr = (prs) => sessionPrs(prs)[0] ?? null;

/** A PR's state as a class for its colour: fail, ready, review, merged or open. @param {Entity} pr */
export function prLevel(pr) {
  if (pr.status === "merged") return "merged";
  const l = pr.attention?.level ?? "";
  return l in RANK ? l : "open";
}

/** One word for a PR's state, in the hover of its number. @param {Entity} pr */
export function prWord(pr) {
  const d = /** @type {Record<string, any>} */ (pr.data);
  if (pr.status === "merged") return "merged";
  if (pr.attention?.level === "fail") return "CI failing";
  if (pr.attention?.level === "ready") return "ready to merge";
  if (pr.attention?.level === "review") return `Review · ${d.author ?? "?"}`;
  return "open";
}

/** @param {Entity} pr */
const num = (pr) => Number(/** @type {any} */ (pr.data).number) || 0;
/** @param {Entity} pr */
const rank = (pr) => RANK[pr.attention?.level ?? ""] ?? 9;
