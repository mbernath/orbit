// Slice 2 of the board redesign: dots, names, bubbles by depth, attention, "Snooze", edge hints, minimap, zoom dots
// Files run in name order against one server: 1-reading expects the fresh fixture, 2-islands changes geometry.
// (docs/design/canvas.md, docs/design/elements.md).
import { expect, type Locator, type Page, test } from "@playwright/test";

type Rect = { x: number; y: number; width: number; height: number };
const rect = async (l: Locator) => (await l.boundingBox()) as Rect;
const session = (page: Page, id: string) => page.locator(`[data-element="session:claude/${id}"]`);
const scale = async (page: Page) => Number((await page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform)).match(/scale\(([^)]+)\)/)?.[1]);
const level = (page: Page, name: "Far" | "Medium" | "Near") => page.getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(session(page, "s1")).toBeVisible();
  await level(page, "Medium").click();
  await expect(level(page, "Medium")).toHaveClass(/on/);
});

test("Sessions are dots with names; a waiting one is orange and speaks in a bubble", async ({ page }) => {
  for (const id of ["s1", "s2"]) await expect(session(page, id)).toHaveClass(/\bsl\b/); // name shown
  await expect(session(page, "s2")).toHaveClass(/g-waiting/);
  await expect(session(page, "s2")).toHaveClass(/\bsb\b/);
  // the concrete question instead of "Claude needs your permission to use Bash" (read only: it runs in VS Code)
  await expect(session(page, "s2").locator(".b-permq")).toHaveText("Allow Bash · npm test?");
  await expect(session(page, "s2").locator(".b-said")).toHaveCount(1); // the question replaces the English notice
  await expect(session(page, "s2").locator(".b-perm button")).toHaveCount(0);
  // ADR-0027: a question of Claude reads as a question, the task list shows its progress
  await expect(session(page, "s3").locator(".b-permq")).toHaveText("Question: Should paused be a stage of its own?");
  await expect(session(page, "s3").locator(".b-meta:not(.b-permhint)")).toContainText("Tasks 1/3");
  await expect(session(page, "s1")).toHaveClass(/g-working/);
  await page.waitForTimeout(400); // let the bubbles finish fading in
  await page.screenshot({ path: "test-results/e2e/reading.png" });
});

test("Hovering lifts a session by one depth, its bubble keeps its corner", async ({ page }) => {
  const s2 = session(page, "s2");
  await expect(s2).toHaveClass(/\bsb\b/); // first placement done
  const depth0 = Number(await s2.getAttribute("data-depth"));
  const corner0 = await s2.locator(".bub").getAttribute("data-corner");
  await s2.locator("[data-dot]").hover();
  await expect(s2).toHaveAttribute("data-depth", String(depth0 + 1));
  expect(await s2.locator(".bub").getAttribute("data-corner")).toBe(corner0);
});

/** Close up, until not everything is in view any more (the compact list layout fits the fixture even at "Near"). */
async function closeUp(page: Page) {
  await level(page, "Near").click();
  await page.mouse.move(700, 450);
  for (let i = 0; i < 20 && !(await page.locator(".minimap").isVisible()); i++) {
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
  }
}

test("Edge hint for a waiting session out of view; a click pans there without zooming", async ({ page }) => {
  await closeUp(page);
  // centre on orbit so that kestrel is out of view
  const mini = page.locator(".minimap");
  await expect(mini).toBeVisible(); // shown once not everything is in view (ADR-0037)
  const m = await rect(mini);
  await page.mouse.click(m.x + 20, m.y + m.height / 2);
  const hint = page.locator(".edge", { hasText: "kestrel" });
  await expect(hint).toBeVisible();
  const k = await scale(page);
  await hint.dispatchEvent("pointerdown");
  await expect(hint).toHaveCount(0);
  const dot = await rect(session(page, "s3").locator("[data-dot]"));
  const vp = await rect(page.locator("#viewport"));
  expect(dot.x > vp.x && dot.x < vp.x + vp.width && dot.y > vp.y && dot.y < vp.y + vp.height).toBe(true);
  expect(await scale(page)).toBe(k);
});

test("The minimap pans the view without zooming; zoom dots switch the levels", async ({ page }) => {
  // everything in view: the minimap adds nothing and is hidden (ADR-0037); close up it shows
  await expect(page.locator(".minimap")).toBeHidden();
  await closeUp(page);
  await expect(page.locator(".minimap")).toBeVisible();
  const before = await page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform);
  const k = await scale(page);
  const m = await rect(page.locator(".minimap"));
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.mouse.move(m.x + m.width / 2 + 30, m.y + m.height / 2, { steps: 3 });
  await page.mouse.up();
  expect(await page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform)).not.toBe(before);
  expect(await scale(page)).toBe(k);
  await level(page, "Near").click();
  await expect(level(page, "Near")).toHaveClass(/on/);
  await level(page, "Far").click();
  await expect(level(page, "Far")).toHaveClass(/on/);
});

test("W jumps to the next session that needs you, Q to the previous one", async ({ page }) => {
  // placement runs on the next frame: wait for the focused element instead of reading at once
  const focused = page.locator(".glyphview.prio");
  await page.locator("#viewport").focus();
  await page.keyboard.press("w");
  await expect(focused).toHaveCount(1);
  // the element W went to looks hovered: its dot is enlarged
  await expect(focused.locator(".glyph")).toHaveCSS("transform", "matrix(1.2, 0, 0, 1.2, 0, 0)");
  const first = await focused.getAttribute("data-element");
  await page.keyboard.press("w");
  await expect(focused).not.toHaveAttribute("data-element", first ?? "");
  await page.keyboard.press("q");
  await expect(focused).toHaveAttribute("data-element", first ?? "");
});

test("W still works after an island's “+” was clicked, and takes the focus from it", async ({ page }) => {
  const plus = page.locator(".frame-add").first();
  await plus.click();
  await expect(page.locator(".menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu")).toHaveCount(0);
  await plus.focus(); // whether or not the browser kept it there after the click
  await page.keyboard.press("w");
  await expect(page.locator(".glyphview.prio")).toHaveCount(1);
  await expect(page.locator("#viewport")).toBeFocused();
  // the board as a whole never gets a ring, only the element W went to
  await expect(page.locator("#viewport")).toHaveCSS("box-shadow", "none");
  await expect(page.locator("#viewport")).toHaveCSS("outline-style", "none");
});

// changes server state (s2 no longer needs the user), so it runs last in this file; the island tests run after this file
test("Snooze takes the session out of attention, it keeps a thin ring", async ({ page }) => {
  const s2 = session(page, "s2");
  await s2.locator("[data-dot]").hover();
  await s2.getByRole("button", { name: "Snooze" }).click();
  await expect(s2).toHaveClass(/g-snoozed/);
  await expect(s2).not.toHaveClass(/g-waiting/);
});

test("After a click on a zoom dot, every board key takes the focus back; no ring on the dot", async ({ page }) => {
  const dot = level(page, "Near");
  await dot.click();
  await dot.focus(); // whether or not the browser kept it there after the click
  for (const key of ["ArrowLeft", "w", "-"]) {
    await page.keyboard.press(key);
    await expect(page.locator("#viewport")).toBeFocused();
    await expect(dot).toHaveCSS("outline-style", "none");
    await dot.focus();
  }
  await page.keyboard.press("Tab"); // Tab still moves focus the normal way
  await expect(page.locator("#viewport")).not.toBeFocused();
});

test("Renaming: the field has a border in the accent colour, no system focus ring", async ({ page }) => {
  await session(page, "s1").locator(".lab-t").dispatchEvent("dblclick"); // without the clicks that open the panel
  const input = session(page, "s1").locator(".title-input");
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await page.screenshot({ path: "test-results/e2e/rename-field.png" });
  await input.press("Escape");
});
