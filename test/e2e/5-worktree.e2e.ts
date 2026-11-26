// ADR-0017: where a session works. Sessions in notes share its main checkout.
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const session = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) });

/** a session in notes that keeps working (the fake CLI never ends a turn that says "long") */
async function startWorking(page: Page, text: string) {
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  const form = page.locator("dialog form");
  await form.locator('select[name="cwd"]').selectOption({ index: 1 });
  await form.locator("textarea").fill(text);
  await form.locator("textarea").press("Enter");
  await expect(session(page, text)).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
});

test("Sessions in the same main checkout quietly warn about each other", async ({ page }) => {
  await startWorking(page, "Work long on the import");
  await startWorking(page, "Work long on the export");
  await session(page, "Work long on the import").locator("[data-dot]").click();
  await expect(panel(page).locator(".p-meta")).toContainText("main checkout · main");
  await expect(panel(page).locator(".p-note.warn")).toContainText("Works in the same checkout as “Work long on the export”");
});

test("While a session works, its bubble shows no old intermediate message", async ({ page }) => {
  const dot = session(page, "Work long on the import");
  await expect(dot).toHaveClass(/g-working/);  await dot.locator("[data-dot]").hover();
  await expect(dot.locator(".b-meta").first()).toContainText("working");
  await expect(dot.locator(".b-said")).toHaveCount(0); // "On it." was only an intermediate message
});

test("New session in its own worktree; removing it from the board offers to remove the worktree", async ({ page }) => {
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  const form = page.locator("dialog form");
  await form.locator('select[name="cwd"]').selectOption({ index: 1 });
  await form.getByLabel("Separate worktree instead of the main checkout").check();
  await form.locator("textarea").fill("Rebuild the export");
  await form.locator("textarea").press("Enter");

  const dot = session(page, "Rebuild the export");
  await dot.locator("[data-dot]").click();
  await expect(panel(page).locator(".p-meta")).toContainText("separate worktree · feat/rebuild-the-export");
  await expect(panel(page).locator(".p-note.warn")).toHaveCount(0); // its own worktree: no shared checkout

  await panel(page).getByRole("button", { name: "Remove from board" }).click();
  const removed = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.removeWorktree"));
  await page.locator("#status").getByRole("button", { name: "Also remove worktree" }).click();
  expect((await removed).status()).toBe(200);
});
