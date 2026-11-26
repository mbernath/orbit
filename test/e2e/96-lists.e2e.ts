// Lists on an island (ADR-0036): "Pin list" with a trial run, the node on the board, the panel with the tree.
// The command is the repo's demo script, run for real in the kestrel island's folder.
import { expect, test } from "@playwright/test";
import { join } from "node:path";

const DEMO = join(import.meta.dirname, "..", "..", "scripts", "orbit-list-demo.sh");

test("Pin list: only after a good trial run, then as a node with a summary and a tree in the panel", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-island-menu="kestrel"]').click();
  await page.locator(".menu").getByRole("button", { name: "Pin list …" }).click();
  const form = page.locator("dialog form");
  const pin = form.getByRole("button", { name: "Pin", exact: true });
  await expect(pin).toBeDisabled();

  // the guide for script authors goes to the clipboard, to hand it to a session
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await form.getByRole("button", { name: "Copy the script guide" }).click();
  await expect(form.getByRole("button", { name: "Guide copied ✓" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# Writing a list script for Orbit");

  // a failing command: the script's own message, nothing to pin
  await form.getByLabel("Command").fill(`${DEMO} error`);
  await form.getByLabel("Command").press("Enter");
  await expect(form.locator(".error")).toHaveText("Demo error: source not reachable");
  await expect(pin).toBeDisabled();

  await form.getByLabel("Command").fill(DEMO);
  await form.getByLabel("Command").press("Enter");
  await expect(form.locator(".list-trial")).toHaveText("13 entries in 3 sections, 1 blocked.");
  await expect(form.getByLabel("Title")).toHaveAttribute("placeholder", "Roadmap (demo)");
  await page.screenshot({ path: "test-results/e2e/list-pin.png" });
  await pin.click();
  await expect(page.locator("dialog")).toHaveCount(0);

  const node = page.locator(".glyphview.g-list");
  await expect(node).toHaveCount(1);
  await expect(node).toHaveClass(/g-blocked/);
  await expect(node.locator(".b-sum")).toHaveText("Now 2 · Next 2 · Later 3 · 1 blocked");
  await node.locator("[data-dot]").hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/e2e/list-node.png" });

  await node.locator("[data-dot]").click();
  const panel = page.locator(".panel");
  await expect(panel.locator(".p-title-ro")).toHaveText("Roadmap (demo)");
  const tree = panel.locator(".l-tree");
  await expect(tree.locator(".l-sec")).toHaveText(["Now", "Next", "Later"]);
  // default filter "Open" hides done children; "Blocked" keeps the epic as the parent of its blocked child
  await expect(tree.getByText("Settle contract v1")).toHaveCount(0);
  await panel.getByRole("button", { name: "Blocked" }).click();
  await expect(tree.locator(".l-item")).toHaveText([/Lists per island/, /View per depth/]);
  await expect(tree.locator(".l-note")).toHaveText("Waiting for the design of depths 0–3.");
  await panel.getByRole("button", { name: "All" }).click();
  await expect(tree.getByText("Settle contract v1")).toBeVisible();
  // badges sit on their own line below the title, so a long badge never squeezes the title
  const epic = tree.locator(".l-item", { hasText: "Lists per island" });
  const titleBox = await epic.locator(".l-title").boundingBox();
  const badgesBox = await epic.locator(".l-badges").boundingBox();
  const rowBox = await epic.boundingBox();
  if (!titleBox || !badgesBox || !rowBox) throw new Error("list row not laid out");
  expect(badgesBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  expect(titleBox.width).toBeGreaterThan(rowBox.width * 0.7);
  // the ref stands before the title and a click copies it, without following the link
  const ref = tree.locator(".l-ref", { hasText: "#5" });
  await expect(ref).toBeVisible();
  await ref.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("#5");
  await expect(node.locator(".l-ref", { hasText: "#1" }).first()).toBeAttached();
  await page.screenshot({ path: "test-results/e2e/list-panel.png" });
});
