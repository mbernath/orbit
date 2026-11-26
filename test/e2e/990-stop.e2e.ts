// Working line and Stop for owned sessions (ADR-0044), against the fake CLI: "long" keeps the turn running a command.
// Runs last, so its extra session does not change what the other files see.
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const session = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) });

async function startSession(page: Page, text: string) {
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  const form = page.locator("dialog form");
  await form.locator('select[name="cwd"]').selectOption({ label: (await form.locator('select[name="cwd"] option').last().textContent()) ?? "" });
  await form.locator("textarea").fill(text);
  await form.locator("textarea").press("Enter");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

test("While Claude works, the panel says what it does and for how long; Stop (or ⌘.) ends the turn and gives back the queue", async ({ page }) => {
  await page.goto("/");
  await startSession(page, "A long job");
  await session(page, "A long job").locator("[data-dot]").click();
  const line = panel(page).locator(".p-conv > .p-activity");
  await expect(line).toContainText("Running bun test …");
  await expect(line.locator(".p-act-time")).toHaveText(/^0:0\d$/);

  // a message while it works waits in the queue …
  const reply = panel(page).getByRole("textbox", { name: "Reply" });
  await reply.fill("And then the docs");
  await reply.press("Enter");
  await expect(panel(page)).toContainText("1 message queued");
  await page.screenshot({ path: "test-results/e2e/owned-working.png" });

  // … and Stop takes it back into the field; no error, the line is gone, the session goes on
  const stopped = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.stop"));
  await line.getByRole("button", { name: "Stop" }).click();
  expect((await stopped).status()).toBe(200);
  await expect(line).toHaveCount(0);
  await expect(reply).toHaveValue("And then the docs");
  await expect(panel(page)).not.toContainText("queued");
  await expect(panel(page).locator(".p-note.err")).toHaveCount(0);
  await expect(panel(page).locator(".msg.you.pending")).toHaveCount(0);
  await expect(panel(page).locator(".p-meta")).toContainText("idle"); // no Stop hook comes for an interrupt
  await page.screenshot({ path: "test-results/e2e/owned-stopped.png" });

  // the session goes on: the next message starts a turn again, and ⌘. in the field stops that one too
  await reply.fill("Another long step");
  await reply.press("Enter");
  await expect(panel(page).locator(".p-activity")).toBeVisible();
  await reply.press("Meta+.");
  await expect(panel(page).locator(".p-activity")).toHaveCount(0);
});
