// @ts-check
// Labels and status classes shared by views.

export const SESSION_STATUS = /** @type {Record<string, string>} */ ({
  working: "working",
  waiting: "waiting for you",
  done: "done",
  idle: "idle",
  inactive: "inactive",
});

export const CI = /** @type {Record<string, string>} */ ({ pass: "CI passing", fail: "CI failing", pending: "CI running", none: "no CI" });

/** Dot class for a PR: red CI first, then mergeable, then the CI state. @param {Record<string, any>} p */
export const prDot = (p) => (p.ci === "fail" ? "ci-fail" : p.mergeable ? "ci-ready" : `ci-${p.ci}`);
