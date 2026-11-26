// ADR-0012 (amendment 2026-11-26): auto-placed dots keep their slot; "Tidy island" closes the holes, with undo.
// Runs last on the shared board: earlier files moved some dots by hand, so only the unmoved ones are compared.
import { expect, type Page, test } from "@playwright/test";

type Spot = { ref: string; x: number; y: number };

/** unmoved glyphs of the island, column by column, top to bottom, with their world position */
async function autoList(page: Page, island: string): Promise<Spot[]> {
  const state = await (await page.request.get("/api/state")).json();
  const moved = new Set((state.elements as { id: string; x: number | null }[]).filter((e) => e.x != null).map((e) => e.id));
  const all: Spot[] = await page.locator(`[data-island="${island}"].glyphview`).evaluateAll((ns) =>
    ns.map((n) => ({ ref: (n as HTMLElement).dataset.element ?? "", x: parseFloat((n as HTMLElement).style.left), y: parseFloat((n as HTMLElement).style.top) })),
  );
  return all.filter((s) => !moved.has(s.ref)).sort((a, b) => a.x - b.x || a.y - b.y);
}
const yOf = async (page: Page, ref: string) => (await autoList(page, "orbit")).find((s) => s.ref === ref)?.y;

test("One-time tidy: an island with hand-moved dots stays and points at Tidy island once; the hint goes with its panel", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) localStorage.setItem("orbit.hints", JSON.stringify(["open", "snooze", "jump", "island", "keys"]));
    sessionStorage.setItem("seeded", "1");
  });
  await page.goto("/");
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  const moved = (state.elements as { id: string; x: number | null }[]).filter((e) => e.x != null).map((e) => e.id);
  const orbitMoved = await page.locator('[data-island="orbit"].glyphview').evaluateAll((ns, m) => ns.some((n) => m.includes((n as HTMLElement).dataset.element ?? "")), moved);
  expect(orbitMoved).toBe(true); // earlier files moved dots in orbit by hand
  const hinted: string[] = JSON.parse((await page.evaluate(() => localStorage.getItem("orbit.tidy-hint"))) ?? "[]");
  expect(hinted).toContain("orbit");
  await expect(page.locator("#hint")).toHaveText("Tidy island: click the name");
  const ringed = page.locator("#world .frame-name.guide-halo"); // ADR-0042: Tidy island lives in the island panel
  await expect(ringed).toHaveCount(1);
  const island = (await ringed.locator("xpath=ancestor::*[@data-frame]").getAttribute("data-frame")) ?? "";
  expect(hinted).toContain(island);
  // the unmoved dots of orbit kept their places: the migration left the island alone
  await ringed.click();
  await expect(page.locator("#panel").getByRole("button", { name: "Tidy island" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#hint")).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator("#hint")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("orbit.tidy-once"))).toBe("1");
});

test("The island is a list; removing one leaves a hole, Tidy island closes it, Undo brings the hole back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
  const before = await autoList(page, "orbit");
  expect(before.length).toBeGreaterThan(3);
  const [a, gone, next] = before as [Spot, Spot, Spot];
  // one below the other: the first column shares one x, rows 48 apart
  expect(gone.x).toBe(a.x);
  expect(gone.y - a.y).toBe(48);
  expect(next.y - gone.y).toBe(48);

  // remove the second one: every other dot stays where it was
  await page.locator(`[data-element="${gone.ref}"] [data-dot]`).click();
  await page.keyboard.press("ControlOrMeta+Shift+Backspace");
  await expect(page.locator(`[data-element="${gone.ref}"]`)).toHaveCount(0);
  expect(await autoList(page, "orbit")).toEqual(before.filter((s) => s.ref !== gone.ref));

  // Tidy island: the third one moves up into the hole
  await page.locator('[data-frame="orbit"] .frame-name').click();
  await page.locator("#panel").getByRole("button", { name: "Tidy island" }).click();
  await expect(page.locator("#status")).toContainText("Island tidied");
  await expect.poll(() => yOf(page, next.ref)).toBe(gone.y);

  // Undo: the hole is back
  await page.locator("#status").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => yOf(page, next.ref)).toBe(next.y);

  // the removed one comes back into its old slot
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(`[data-element="${gone.ref}"]`)).toHaveCount(1);
  await expect.poll(() => yOf(page, gone.ref)).toBe(gone.y);
});

test("An island with a waiting question: the question shows, nobody moves (screenshot)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-frame="kestrel"]')).toBeVisible();
  const start = async (text: string) => {
    await page.locator('[data-island-menu="kestrel"]').click();
    await page.locator(".menu").getByRole("button", { name: "New session …" }).click();
    const form = page.locator("dialog form");
    await form.locator("textarea").fill(text);
    await form.locator("textarea").press("Enter");
    await expect(page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: text }) })).toHaveCount(1);
  };
  await start("Sort the notes");
  await start("Tag the releases");
  const before = await autoList(page, "kestrel");
  await start("Ask me for a colour about kestrel");
  const asking = page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: "Ask me for a colour about kestrel" }) });
  await expect(asking).toHaveClass(/g-waiting/);
  await expect(asking).toHaveClass(/\bsb\b/); // its question bubble is placed
  // the new one took the next slot; the others stayed
  expect((await autoList(page, "kestrel")).filter((s) => before.some((b) => b.ref === s.ref))).toEqual(before);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400); // let the bubbles finish fading in
  // free canvas right of kestrel: a done session's answer shows beside its name, reaching past the island border
  const beside = page.locator('[data-island="kestrel"].glyphview.g-done.sb .bub[data-corner="e"]');
  await expect(beside.first()).toBeVisible();
  const fr = (await page.locator('[data-frame="kestrel"]').boundingBox())!, bb = (await beside.first().boundingBox())!;
  expect(bb.x + bb.width).toBeGreaterThan(fr.x + fr.width);
  await page.screenshot({ path: "test-results/e2e/layout-list.png" });
});
