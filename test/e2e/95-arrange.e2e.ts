// Several elements at once (ADR-0034): ⇧-drag selects, the bar aligns, dragging moves the group, Esc clears.
import { expect, type Page, test } from "@playwright/test";

const dot = (page: Page, s: string) => page.locator(`[data-element="session:claude/${s}"] .glyph`);
const centre = async (page: Page, s: string) => {
  const b = (await dot(page, s).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const saved = (page: Page) => page.waitForResponse((r) => /\/api\/actions\/canvas\.frame$/.test(r.url()));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1500 }); // the orbit island is tall by now
  await page.goto("/");
  await expect(dot(page, "s2")).toBeVisible();
});

test("⇧-drag selects, the bar aligns, the group drags along, Esc clears", async ({ page }) => {
  const frame = (await page.locator('[data-frame="orbit"]').boundingBox())!;
  const bar = page.locator(".arrange");
  await expect(bar).toBeHidden();

  // ⇧ + drag across the whole orbit island selects s1 and s2, nothing in kestrel
  await page.keyboard.down("Shift");
  await page.mouse.move(frame.x + 4, frame.y + 30);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width - 4, frame.y + frame.height - 4, { steps: 6 });
  await expect(page.locator(".lasso")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(bar).toBeVisible();
  const inOrbit = await page.locator('.element[data-island="orbit"]').count();
  expect(inOrbit).toBeGreaterThan(1);
  // every orbit element is selected, none of kestrel (files without an island sit at 0,0 inside orbit's frame, debt)
  await expect(page.locator('.element.selected[data-island="orbit"]')).toHaveCount(inOrbit);
  await expect(page.locator('.element.selected[data-island="kestrel"]')).toHaveCount(0);
  await expect(bar).toContainText(`${await page.locator(".element.selected").count()} selected`);
  await page.screenshot({ path: "test-results/e2e/arrange-selected.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".element.selected")).toHaveCount(0);

  // ⇧ + click picks exactly s1 and s2
  for (const s of ["s1", "s2"]) {
    await page.mouse.move(5, 5); // no hover bubble left over the next dot
    await expect(page.locator(".glyphview.prio")).toHaveCount(0);
    const c = await centre(page, s);
    await page.keyboard.down("Shift");
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up("Shift");
  }
  await expect(bar).toContainText("2 selected");
  await expect(page.locator(".element.selected")).toHaveCount(2);

  // align on top: both dots on one line
  let save = saved(page);
  await bar.getByRole("button", { name: "Align top" }).click();
  expect((await save).status()).toBe(200);
  await expect.poll(async () => Math.round((await centre(page, "s1")).y - (await centre(page, "s2")).y)).toBe(0);
  await expect(page.locator("#status")).toContainText("Aligned");

  // dragging one selected dot moves both by the same amount
  const a0 = await centre(page, "s1"), b0 = await centre(page, "s2");
  save = saved(page);
  await page.mouse.move(a0.x, a0.y);
  await page.mouse.down();
  await page.mouse.move(a0.x + 20, a0.y + 30, { steps: 6 });
  await page.mouse.up();
  expect((await save).status()).toBe(200);
  const a1 = await centre(page, "s1"), b1 = await centre(page, "s2");
  expect(Math.round(a1.y - a0.y)).toBeGreaterThan(10);
  expect(Math.round(a1.x - a0.x)).toBe(Math.round(b1.x - b0.x));
  expect(Math.round(a1.y - a0.y)).toBe(Math.round(b1.y - b0.y));

  // ⌘Z undoes the group move
  save = saved(page);
  await page.keyboard.press("Meta+z");
  expect((await save).status()).toBe(200);
  await expect.poll(async () => Math.round((await centre(page, "s1")).y)).toBe(Math.round(a0.y));

  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator(".element.selected")).toHaveCount(0);
});
