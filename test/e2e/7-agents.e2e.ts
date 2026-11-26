// Agents on the board (ADR-0015, ADR-0020): a dot with a moon, trigger read back, runs inside the agent.
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const agentDot = (page: Page, name: string) => page.locator(".glyphview.agent", { has: page.locator(".lab-t", { hasText: name }) });

test("New agent: a dot with a moon, the trigger is read back", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-island-menu="kestrel"]').click();
  await page.locator(".menu").getByRole("button", { name: "New agent …" }).click();
  const form = page.locator("dialog form");
  await form.getByLabel("Name").fill("Tidier");
  await form.getByLabel("Role").fill("Tidies the roadmap after every merge.");
  await form.getByLabel("Trigger").fill("after every merge into main");
  await form.getByRole("button", { name: "Create" }).click();

  const dot = agentDot(page, "Tidier");
  await expect(dot.locator(".moon")).toBeVisible();
  await dot.locator("[data-dot]").click();
  await expect(panel(page).locator(".p-title-ro")).toHaveText("Tidier");
  await expect(panel(page).locator(".p-reading")).toHaveText("Runs: after every merge into main");
  await expect(panel(page).getByRole("textbox", { name: "Role" })).toHaveValue("Tidies the roadmap after every merge.");
  // its memory is a document in the island
  await expect(page.locator(".glyphview.g-page .lab-t", { hasText: "tidier" })).toHaveCount(1); // name may yield to others
});

test("Run now: the run gets no dot of its own and is listed in the agent; a click opens its conversation", async ({ page }) => {
  await page.goto("/");
  const dot = agentDot(page, "Tidier");
  await dot.locator("[data-dot]").click();
  const dotsBefore = await page.locator(".glyphview:not(.agent):not(.g-page)").count();
  await panel(page).getByRole("button", { name: "Run now" }).click();
  await expect(panel(page).locator(".p-run-item")).toContainText("Started by hand.");
  await expect(dot).toHaveClass(/g-working|g-rest/);
  await page.waitForTimeout(300); // the fake CLI reports the run through the hook
  expect(await page.locator(".glyphview:not(.agent):not(.g-page)").count()).toBe(dotsBefore);

  await panel(page).locator(".p-run-item").first().click();
  await expect(panel(page).getByRole("textbox", { name: "Reply" })).toBeVisible(); // the run's own conversation
});

test("A trigger that is not understood: runs only by hand, and the agent says so", async ({ page }) => {
  await page.goto("/");
  await agentDot(page, "Tidier").locator("[data-dot]").click();
  const trigger = panel(page).getByRole("textbox", { name: "When does it run?" });
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/actions/agents.update"));
  await trigger.fill("at every phase of the moon");
  await trigger.press("Enter");
  expect((await saved).status()).toBe(200);
  await expect(panel(page).locator(".p-reading")).toHaveText("Trigger not understood: runs only when you start it.");
  await expect(panel(page).locator(".p-reading")).toHaveClass(/warn/);
});
