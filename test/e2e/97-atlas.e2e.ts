// Atlas level (ADR-0037, docs/design/canvas.md "Atlas level"): far out, an island is a region on a map — its name,
// and the places that need the user as orange glyphs at their real position. Nothing else.
import { expect, type Page, test } from "@playwright/test";

const scale = async (page: Page) =>
  Number((await page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform)).match(/scale\(([\d.]+)\)/)?.[1]);
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function zoomOut(page: Page) {
  await page.mouse.move(700, 450);
  // small steps: stop just past the atlas threshold, where the (now compact) islands still have room for their names
  for (let i = 0; i < 200 && !(await page.locator("#viewport.atlas-on").count()); i++) {
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 40);
    await page.keyboard.up("Control");
  }
  await expect(page.locator("#viewport.atlas-on")).toHaveCount(1);
  await page.mouse.move(5, 5); // off every island, so no hover state is in the picture
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
  await expect(page.locator('[data-element="session:claude/s3"]')).toBeVisible();
});

test("Far out: island names as on a map, only places that need you, at their real position", async ({ page }) => {
  await zoomOut(page);
  await expect(page.locator(".atlas-isle")).toHaveCount(await page.locator("[data-frame]").count());
  for (const el of await page.locator("#world .element").all()) await expect(el).toHaveCSS("opacity", "0");
  // one name size for every island, never leaving its island, never shortened
  const sizes = new Set<string>();
  for (const tile of await page.locator(".atlas-isle").all()) {
    const name = tile.locator(".a-name");
    if (!(await name.count())) continue;
    sizes.add(await name.evaluate((n) => getComputedStyle(n).fontSize));
    const t = (await tile.boundingBox())!, n = (await name.boundingBox())!;
    expect(n.x + n.width <= t.x + t.width + 0.5 && n.y + n.height <= t.y + t.height + 0.5).toBe(true);
    expect(await name.textContent()).not.toContain("…");
    for (const pl of await tile.locator(".a-place").all()) {
      const c = centre((await pl.boundingBox())!);
      expect(c.x > n.x && c.x < n.x + n.width && c.y > n.y && c.y < n.y + n.height).toBe(false); // a name never covers a place
    }
  }
  expect(sizes.size).toBe(1);
  // s3 waits in kestrel: its place sits exactly where its glyph is on the other levels
  const place = page.locator('.a-place[data-atlas-ref="session:claude/s3"]');
  await expect(place).toHaveCount(1);
  const p = centre((await place.boundingBox())!), g = centre((await page.locator('[data-element="session:claude/s3"] .glyph').boundingBox())!);
  expect(Math.abs(p.x - g.x)).toBeLessThan(2);
  expect(Math.abs(p.y - g.y)).toBeLessThan(2);
  // only places that need the user: s1 (just started, nothing asked) has none; no place carries text
  for (const s of ["s1"]) {
    await expect(page.locator(`[data-element="session:claude/${s}"]`)).toHaveCount(1);
    await expect(page.locator(`.a-place[data-atlas-ref="session:claude/${s}"]`)).toHaveCount(0);
  }
  for (const pl of await page.locator(".a-place").all()) expect(await pl.textContent()).toBe("");
  await expect(page.locator(".minimap")).toBeHidden();
  await page.screenshot({ path: "test-results/e2e/atlas.png" });
});

test("A click on an island shows it at the medium level, a click on a place goes to its element", async ({ page }) => {
  await zoomOut(page);
  const box = (await page.locator('[data-frame="orbit"]').boundingBox())!;
  await page.locator('[data-atlas="orbit"]').click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#viewport.atlas-on")).toHaveCount(0);
  expect(await scale(page)).toBe(1);
  expect((await page.locator('[data-frame="orbit"]').boundingBox())!.width / box.width).toBeGreaterThan(2);

  await zoomOut(page);
  await page.locator('.a-place[data-atlas-ref="session:claude/s3"]').click();
  await expect(page.locator("#viewport.atlas-on")).toHaveCount(0);
  await expect(page.locator('[data-element="session:claude/s3"]')).toHaveClass(/prio/);
});
