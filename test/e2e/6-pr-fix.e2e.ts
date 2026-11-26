// ADR-0014: a session fixes its PR and merges it. The fixture's repo acme/notes has PR #7 with red CI on the branch
// feat/fix-the-export; a session started in its own worktree with that name works on it (ADR-0017, ADR-0024).
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const session = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) });

test("Failing PR: Fix and merge sends the session the task with PR and reason", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-element^="repo:"]')).toHaveCount(0); // no repo boxes: PRs show at their sessions
  // sessions in the shared main checkout never inherit a PR they did not create (ADR-0024)
  await expect(session(page, "Write the docs").locator(".pr-chip")).toHaveCount(0);
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  const form = page.locator("dialog form");
  await form.locator('select[name="cwd"]').selectOption({ index: 1 });
  await form.getByLabel("Separate worktree instead of the main checkout").check();
  await form.locator("textarea").fill("Fix the export");
  await form.locator("textarea").press("Enter");
  const dot = session(page, "Fix the export");
  await expect(dot.locator(".lab .pr-chip")).toHaveText("#7");
  await expect(dot.locator(".lab .pr-chip")).toHaveAttribute("href", "https://github.com/acme/notes/pull/7");
  await expect(dot.locator(".lab .pr-chip")).toHaveClass(/needs/);

  await dot.locator("[data-dot]").click();
  await expect(panel(page).locator(".p-prstate")).toContainText("CI failing");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/actions/owned.send"));
  await panel(page).getByRole("button", { name: "Fix and merge" }).click();
  const text = (await sent).postDataJSON().input.text as string;
  expect(text).toContain("PR #7 (“Rework the export”): CI failing");
  expect(text).toContain("Please fix it, then squash-merge it");
});
