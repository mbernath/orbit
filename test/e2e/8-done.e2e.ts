// ADR-0023: a session whose PR is merged reads as done and can be cleared in one click.
import { expect, test } from "@playwright/test";

const s4 = '[data-element="session:claude/s4"]';

test("Merged PR: a check mark on the dot, “#5 ✓”, no orange, no edge hint", async ({ page }) => {
  await page.goto("/");
  const dot = page.locator(s4);
  await expect(dot).toHaveClass(/g-finished/);
  await expect(dot.locator(".lab .pr-chip")).toHaveText("#5 ✓");
  await expect(dot.locator(".lab .pr-chip")).toHaveClass(/merged/);
  await expect(page.locator('.edges [data-hint="session:claude/s4"]')).toHaveCount(0);
});

test("The detail panel says “merged into main”; “Done · Remove from board” with undo", async ({ page }) => {
  await page.goto("/");
  await page.locator(`${s4} [data-dot]`).click();
  await expect(page.locator("#panel .p-prstate")).toContainText("merged into main");
  await page.locator("#panel").getByRole("button", { name: "Done · Remove from board" }).click();
  await expect(page.locator(s4)).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("removed from board");
  await page.locator("#status").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(s4)).toHaveCount(1);
});

test("A done session no longer offers “Snooze”", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(s4)).toHaveClass(/g-finished/);
  await expect(page.locator(`${s4} .b-act`)).toHaveCount(0);
});

test("⌘⇧⌫ removes the open element from the board, even from a text field in the detail panel", async ({ page }) => {
  await page.goto("/");
  await page.locator(`${s4} [data-dot]`).click();
  const title = page.locator("#panel").getByRole("textbox", { name: "Title" });
  await title.focus();
  await page.keyboard.press("ControlOrMeta+Shift+Backspace");
  await expect(page.locator(s4)).toHaveCount(0);
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#status")).toContainText("removed from board");
  await page.locator("#status").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(s4)).toHaveCount(1);
});
test("Island panel: Remove done from board · 1, confirmed in place, with undo (ADR-0042)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-frame="orbit"] .frame-name').click();
  const p = page.locator("#panel");
  await p.getByRole("button", { name: "Remove done from board · 1" }).click();
  await expect(p).toContainText("Remove 1 done from board?");
  await p.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(s4)).toHaveCount(0);
  await expect(p.getByRole("button", { name: "Remove done from board" })).toBeDisabled();
  await page.locator("#status").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(s4)).toHaveCount(1);
});
