// ADR-0038: PRs without a session show as one pill beside the island's "+"; more lie stacked behind it, and a click
// on the stack lists them all instead of opening GitHub. The fixture's acme/notes has two PRs by anna asking for the
// user's review and no session on their branches; PR #7 has its session by now (6-pr-fix), so it is not among them.
import { expect, test } from "@playwright/test";

test("PRs without a session: a pill with the number, a stack behind it, a click lists them all", async ({ page }) => {
  await page.goto("/");
  const head = page.locator('[data-frame="orbit"] .frame-head');
  const pill = head.locator(".frame-pr");
  await expect(pill).toHaveText("#11");
  await expect(pill).toHaveClass(/foreign/);
  await expect(pill).toHaveClass(/review/);
  await expect(pill).toHaveClass(/stacked/);
  await expect(pill).toHaveAttribute("title", /^Review · anna · .+ · 1 more PR, click to list$/);
  await expect(head.locator(".frame-pr-more")).toHaveCount(0);
  await expect(page.locator('[data-frame="kestrel"] .frame-pr')).toHaveCount(0);

  await pill.click();
  const menu = page.locator(".pr-menu");
  await expect(menu.locator(".pr-row")).toHaveCount(2);
  await expect(menu.locator(".menu-title")).toHaveCount(0); // no "n PRs" header: the rows say it
  await expect(menu.locator(".pr-row-num.review")).toHaveCount(2);
  await expect(menu.locator(".pr-row").first()).toHaveAttribute("title", "Review · anna");
  await expect(menu.locator(".pr-row").first()).toHaveAttribute("href", "https://github.com/acme/notes/pull/11");
  await expect(menu.locator(".pr-row").nth(1)).toContainText("#12");
  await expect(menu.locator(".pr-row").nth(1)).toContainText("Someone else's PR 12");
  await page.screenshot({ path: `${process.env.TMPDIR ?? "."}/orbit-island-prs.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
