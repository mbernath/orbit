// Working in the detail panel (docs/design/interaction.md "Detail panel"): width, full mode, a growing reply field,
// ⌘⇧Enter to send and move on, Esc in an empty field. Runs after 4- (uses its owned sessions).
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const session = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) });
const width = (page: Page) => panel(page).evaluate((p) => Math.round(p.getBoundingClientRect().width));
const reply = (page: Page) => panel(page).getByRole("textbox", { name: "Reply" });

async function openDocs(page: Page) {
  const dot = session(page, "Write the docs").locator("[data-dot]");
  // the orbit island holds many sessions by now: pan (wheel) until the dot is in the middle of the board
  const y = await dot.evaluate((d) => d.getBoundingClientRect().top);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, y - 400);
  await expect.poll(() => dot.evaluate((d) => Math.round(d.getBoundingClientRect().top))).toBeLessThan(500);
  await dot.click();
  await expect(reply(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orbit.panel")).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
});

test("Dragging the left edge widens the detail panel; the width stays after a reload", async ({ page }) => {
  await openDocs(page);
  expect(await width(page)).toBe(420);
  const edge = page.locator(".panel-edge");
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width(page)).toBeGreaterThan(700);
  const wide = await width(page);
  await page.reload();
  await openDocs(page);
  expect(await width(page)).toBe(wide);
  await page.locator(".panel-edge").dblclick();
  expect(await width(page)).toBe(420);
});

test("⌘⇧F switches to full width from the reply field and back; so does ⤢", async ({ page }) => {
  await openDocs(page);
  await reply(page).focus();
  await page.keyboard.press("Meta+Shift+F");
  await expect(page.locator("#viewport")).toBeHidden();
  expect(await width(page)).toBe(1400);
  await expect(reply(page)).toBeFocused();
  await page.screenshot({ path: "test-results/e2e/panel-full.png" });
  await page.keyboard.press("Meta+Shift+F");
  await expect(page.locator("#viewport")).toBeVisible();
  await panel(page).getByRole("button", { name: "Full width" }).click();
  await expect(page.locator("#viewport")).toBeHidden();
  await panel(page).getByRole("button", { name: "Full width" }).click();
  await expect(page.locator("#viewport")).toBeVisible();
});

test("Enter opens in full width with the cursor in the reply field", async ({ page }) => {
  await openDocs(page);
  await page.keyboard.press("Meta+Shift+F");
  await panel(page).getByRole("button", { name: "Close" }).click();
  // the click on the dot made it the keyboard focus; Enter on the board opens it again
  await page.locator("#viewport").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#viewport")).toBeHidden();
  await expect(reply(page)).toBeFocused();
  await page.keyboard.type("hello");
  await expect(reply(page)).toHaveValue("hello");
});

test("A click on the session puts the cursor in the reply field – normal and in full width", async ({ page }) => {
  await openDocs(page);
  await expect(reply(page)).toBeFocused();
  await page.keyboard.type("a");
  await expect(reply(page)).toHaveValue("a");
  await page.keyboard.press("Meta+Shift+F");
  await panel(page).getByRole("button", { name: "Close" }).click();
  await session(page, "Write the docs").locator("[data-dot]").click();
  await expect(page.locator("#viewport")).toBeHidden();
  await expect(reply(page)).toBeFocused();
});

test("Full width does not move the board: after closing it stands as before", async ({ page }) => {
  const camera = () => page.locator("#world").evaluate((w) => w.style.transform);
  await openDocs(page);
  const before = await camera();
  // switched on while open
  await page.keyboard.press("Meta+Shift+F");
  await expect(page.locator("#viewport")).toBeHidden();
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#viewport")).toBeVisible();
  expect(await camera()).toBe(before);
  // already on when opening (full mode is remembered)
  await session(page, "Write the docs").locator("[data-dot]").click();
  await expect(page.locator("#viewport")).toBeHidden();
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#viewport")).toBeVisible();
  expect(await camera()).toBe(before);
});

test("The reply field grows with the text and can be dragged taller at its grip", async ({ page }) => {
  await openDocs(page);
  const h = () => reply(page).evaluate((t) => t.getBoundingClientRect().height);
  const small = await h();
  await reply(page).fill(Array.from({ length: 8 }, (_, i) => `Line ${i}`).join("\n"));
  expect(await h()).toBeGreaterThan(small * 2);
  await reply(page).fill("");
  expect(await h()).toBe(small);
  const grip = (await panel(page).locator(".p-grip").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 150, { steps: 5 });
  await page.mouse.up();
  expect(await h()).toBeGreaterThan(small + 100);
  await page.screenshot({ path: "test-results/e2e/panel-reply-tall.png" });
});

test("Esc in an empty reply field closes the detail panel at once; with text only the field", async ({ page }) => {
  await openDocs(page);
  await reply(page).fill("Draft");
  await reply(page).press("Escape");
  await expect(panel(page)).toBeVisible();
  await reply(page).fill("");
  await reply(page).press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("#viewport")).toBeFocused();
});

test("⌘⇧Enter sends and opens the next session that needs me – or reports “All done”", async ({ page }) => {
  await openDocs(page);
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.send"));
  await reply(page).fill("Keep going");
  await reply(page).press("Meta+Shift+Enter");
  expect((await sent).status()).toBe(200);
  await expect
    .poll(async () => (await panel(page).isHidden()) ? "closed" : await panel(page).locator(".p-title, .p-title-ro").first().evaluate((n) => (n as HTMLInputElement).value ?? n.textContent))
    .not.toBe("Write the docs");
  if (await panel(page).isHidden()) {
    await expect(page.locator("#status")).toHaveText("All done");
    await expect(page.locator("#viewport")).toBeFocused();
  } else if (await reply(page).count()) {
    await expect(reply(page)).toBeFocused();
  }
});

test("A title that changes in full width stays inside its island afterwards", async ({ page }) => {
  // measured while the board was hidden, a name had width 0 and was never shortened (measure.js, layoutNow)
  await openDocs(page);
  const node = session(page, "Write the docs");
  const ref = (await node.getAttribute("data-element")) as string;
  await page.keyboard.press("Meta+Shift+F");
  await expect(page.locator("#viewport")).toBeHidden();
  const rename = (title: string | null) =>
    page.evaluate(async ([id, title, api]) => (await import(api as string)).runAction("claude.rename", { id, title }), [ref.split("/").pop(), title, "/js/api.js"]);
  await rename("A very long title, set in full width while the board is hidden, that reaches far beyond the island");
  const el = page.locator(`[data-element="${ref}"]`);
  await expect(el.locator(".lab-t")).toContainText("A very long title");
  await page.waitForTimeout(200); // a layout pass while hidden
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#viewport")).toBeVisible();
  const overflow = () =>
    el.evaluate((n) => {
      const lab = n.querySelector(".lab")!.getBoundingClientRect();
      const frame = document.querySelector('[data-frame="orbit"]')!.getBoundingClientRect();
      return Math.round(lab.right - frame.right);
    });
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  await rename(null);
});
