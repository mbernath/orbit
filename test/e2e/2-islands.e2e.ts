// Slice 1 of the board redesign: islands as frames, camera rules, island menu (docs/design/canvas.md, ADR-0012/0013).
import { expect, type Locator, type Page, test } from "@playwright/test";

type Rect = { x: number; y: number; width: number; height: number };
const GAP = 28; // frames keep this world distance; at zoom ≤ 1 the screen distance can be smaller, so we test "no overlap"

const rect = async (l: Locator) => (await l.boundingBox()) as Rect;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, f: Rect) => a.x >= f.x && a.y >= f.y && a.x + a.width <= f.x + f.width + 0.5 && a.y + a.height <= f.y + f.height + 0.5;
const frame = (page: Page, id: string) => page.locator(`[data-frame="${id}"]`);
const transform = (page: Page) => page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform);

/** drag with real pointer events from the centre of `from` by (dx, dy); waits for the save when one is expected */
async function drag(page: Page, from: Locator, dx: number, dy: number, saves = true) {
  const b = await rect(from);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const saved = saves ? page.waitForResponse((r) => /\/api\/actions\/canvas\.(frame|place)$/.test(r.url())) : null;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  if (saved) expect((await saved).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page, "orbit")).toBeVisible();
  await expect(page.locator('[data-element="session:claude/s3"]')).toBeVisible();
});

test("Islands instead of columns: no sidebar, frames do not overlap, sessions lie in their island", async ({ page }) => {
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".toolbar")).toHaveCount(0);
  const orbit = await rect(frame(page, "orbit")), kestrel = await rect(frame(page, "kestrel"));
  expect(overlap(orbit, kestrel)).toBe(false);
  for (const [s, f] of [["s1", orbit], ["s2", orbit], ["s3", kestrel]] as const)
    // the dot lies in its island; the element box around it is bubble room and may reach beyond (ADR-0012, 2026-11-26)
    expect(inside(await rect(page.locator(`[data-element="session:claude/${s}"] [data-dot]`)), f)).toBe(true);
  await page.screenshot({ path: "test-results/e2e/islands.png" });
});

test("Moving an island by its name takes its content along and stays after a reload", async ({ page }) => {
  const f0 = await rect(frame(page, "kestrel")), c0 = await rect(page.locator('[data-element="session:claude/s3"]'));
  await drag(page, page.locator('[data-frame="kestrel"] .frame-name'), 120, 140);
  const f1 = await rect(frame(page, "kestrel")), c1 = await rect(page.locator('[data-element="session:claude/s3"]'));
  expect(Math.round(f1.y - f0.y)).toBeGreaterThan(100);
  expect(Math.round(c1.x - c0.x)).toBe(Math.round(f1.x - f0.x)); // content moved by the same amount
  expect(Math.round(c1.y - c0.y)).toBe(Math.round(f1.y - f0.y));
  // an auto-placed dot follows through its slot: moving the island stores no position for it (ADR-0012)
  const stored = async () => ((await (await page.request.get("/api/state")).json()).elements as { id: string; x: number | null }[]).find((e) => e.id === "session:claude/s3")?.x ?? null;
  expect(await stored()).toBeNull();
  await page.reload();
  await expect(frame(page, "kestrel")).toBeVisible();
  const f2 = await rect(frame(page, "kestrel"));
  expect(Math.abs(f2.x - f1.x) + Math.abs(f2.y - f1.y)).toBeLessThan(2);
  const c2 = await rect(page.locator('[data-element="session:claude/s3"]'));
  expect(Math.abs(c2.x - f2.x - (c0.x - f0.x)) + Math.abs(c2.y - f2.y - (c0.y - f0.y))).toBeLessThan(2); // same slot in the frame
});

test("An island cannot be pushed onto another one", async ({ page }) => {
  const o = await rect(frame(page, "orbit")), g = await rect(frame(page, "kestrel"));
  await drag(page, page.locator('[data-frame="kestrel"] .frame-name'), o.x - g.x + 40, o.y - g.y + 40);
  expect(overlap(await rect(frame(page, "orbit")), await rect(frame(page, "kestrel")))).toBe(false);
});

test("Resizing at the corner; dropping an element past the edge grows the island once", async ({ page }) => {
  const f0 = await rect(frame(page, "orbit"));
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await drag(page, page.locator('[data-frame-resize="orbit"]'), 0, 120);
  const f1 = await rect(frame(page, "orbit"));
  expect(f1.height).toBeGreaterThan(f0.height + 60);

  // a session is grabbed at its dot (its box around the dot does not take the pointer)
  const dot = page.locator('[data-element="session:claude/s1"] [data-dot]');
  const c = await rect(dot);
  await drag(page, dot, 0, f1.y + f1.height - c.y + 40); // drop below the bottom edge
  const f2 = await rect(frame(page, "orbit"));
  expect(f2.height).toBeGreaterThan(f1.height);
  expect(inside(await rect(dot), f2)).toBe(true); // the dot, not the room for its bubble (frames.js holdOf)
});

test("A dot can be dragged up to the island's right edge, even when there is no room for its bubble", async ({ page }) => {
  const dot = page.locator('[data-element="session:claude/s1"] [data-dot]');
  const f = await rect(frame(page, "orbit")), g = await rect(frame(page, "kestrel"));
  // push the right edge of orbit close to kestrel so it cannot grow to the right
  await drag(page, page.locator('[data-frame-resize="orbit"]'), g.x - (f.x + f.width) - 40, 0);
  const f1 = await rect(frame(page, "orbit"));
  const c = await rect(dot);
  await drag(page, dot, f1.x + f1.width - (c.x + c.width) + 200, 0); // far beyond the right edge, towards kestrel
  const f2 = await rect(frame(page, "orbit")), d = await rect(dot), box = await rect(page.locator('[data-element="session:claude/s1"]'));
  expect(inside(d, f2)).toBe(true);
  expect(f2.x + f2.width - (d.x + d.width)).toBeLessThan(80); // at the edge, not ~260 away
  expect(box.x + box.width).toBeGreaterThan(f2.x + f2.width); // the bubble room pokes out, that is allowed
  await page.screenshot({ path: "test-results/e2e/drop-at-edge.png" });
});

test("Dialogs share one component (ADR-0042): Pin file opens centred, searches, Esc and Close shut it", async ({ page }) => {
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await page.locator('[data-island-menu="orbit"]').click();
  await page.getByRole("button", { name: "Pin file …" }).click();
  const dlg = page.locator("dialog.dlg.centred");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("textbox", { name: "Search" })).toBeFocused();
  await expect(dlg.locator(".file-item")).toContainText(["README.md"]);
  await dlg.getByRole("textbox", { name: "Search" }).fill("no-such-file");
  await expect(dlg.locator(".empty")).toHaveText("No matches.");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.locator('[data-island-menu="orbit"]').click();
  await page.getByRole("button", { name: "Pin file …" }).click();
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
});

/** "New island" from a double-click on free space (ADR-0042: no longer behind an island's "+") */
async function newIslandDialog(page: Page) {
  const vp = (await page.locator("#viewport").boundingBox())!;
  await page.mouse.dblclick(vp.x + vp.width - 30, vp.y + 30);
  await expect(page.locator("dialog.anchored .dlg-title")).toHaveText("New island");
}

test("The “+” only adds: New session, New agent, Pin file, Pin list (ADR-0042)", async ({ page }) => {
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await page.locator('[data-island-menu="orbit"]').click();
  await expect(page.locator(".menu button")).toHaveText(["New session …N", "New agent …", "Pin file …", "Pin list …"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu")).toHaveCount(0);
});

test("New island: create one", async ({ page }) => {
  await newIslandDialog(page);
  await page.getByPlaceholder("Name, e.g. customer-portal").fill("Customer portal");
  await page.getByPlaceholder("Folder, e.g. ~/Src/customer-portal").fill("/fixture/customer-portal");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(frame(page, "customer-portal")).toBeVisible();
  const all = await Promise.all(["orbit", "kestrel", "customer-portal"].map((id) => rect(frame(page, id))));
  expect(all.every((a, i) => all.slice(i + 1).every((b) => !overlap(a, b)))).toBe(true);
});

test("New island: “Choose folder …” fills the path and an empty name", async ({ page }) => {
  // the native dialog runs on the server (ADR-0035); here its answer is stubbed
  await page.route("**/api/actions/workspaces.pickFolder", (r) => r.fulfill({ json: { ok: true, data: { path: "/fixture/shop" } } }));
  await newIslandDialog(page);
  await page.getByRole("button", { name: "Choose folder …" }).click();
  await expect(page.getByLabel("Folder")).toHaveValue("/fixture/shop");
  await expect(page.getByLabel("Name")).toHaveValue("shop");
  await page.locator("dialog").screenshot({ path: `${process.env.TMPDIR ?? "."}/orbit-pick-folder.png` });
});

test("Camera: scrolling pans, ⌘ + scrolling zooms; opening a menu moves nothing", async ({ page }) => {
  const t0 = await transform(page);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 120);
  const t1 = await transform(page);
  expect(t1).not.toBe(t0);
  expect(t1.match(/scale\(([^)]+)\)/)?.[1]).toBe(t0.match(/scale\(([^)]+)\)/)?.[1]); // pan only
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Meta");
  expect((await transform(page)).match(/scale\(([^)]+)\)/)?.[1]).not.toBe(t1.match(/scale\(([^)]+)\)/)?.[1]);
  await page.getByRole("button", { name: "Far" }).click();
  const t2 = await transform(page);
  await page.locator('[data-frame="kestrel"] .frame-head').hover();
  await page.locator('[data-island-menu="kestrel"]').click();
  await page.keyboard.press("Escape");
  expect(await transform(page)).toBe(t2);
});

void GAP;

test("An island's plus button stays visible while the pointer rests on a name inside it", async ({ page }) => {
  const add = page.locator('[data-island-menu="kestrel"]');
  await page.locator('[data-element="session:claude/s3"] .lab-t').hover();
  await expect(add).toHaveCSS("opacity", "1");
});

test("Dropping an element leaves all others untouched (no rebuild, no flicker)", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).changes = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = (m.target as HTMLElement).closest?.("[data-element]") as HTMLElement | null;
        if (el && !el.dataset.element?.endsWith("/s1")) (window as any).changes.push(`${el.dataset.element} ${m.type} ${m.attributeName ?? ""}`);
      }
    }).observe(document.getElementById("world")!, { subtree: true, attributes: true, childList: true });
  });
  await drag(page, page.locator('[data-element="session:claude/s1"] [data-dot]'), 40, 30);
  await page.waitForTimeout(600); // the server's confirmation renders once more
  expect(await page.evaluate(() => (window as any).changes)).toEqual([]);
});

test("A double-click on empty space outside the islands opens “New island” at that spot", async ({ page }) => {
  const vp = (await page.locator("#viewport").boundingBox())!;
  await page.mouse.dblclick(vp.x + vp.width - 30, vp.y + 30);
  await expect(page.locator("dialog .dlg-title")).toHaveText("New island");
  await expect(page.locator("dialog").getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  // inside an island it does not
  const f = (await page.locator('[data-frame="kestrel"]').boundingBox())!;
  await page.mouse.dblclick(f.x + f.width - 20, f.y + f.height - 40);
  await expect(page.locator("dialog")).toHaveCount(0);
});

test("Zoomed far out, dots and names shrink along, the bubble does not (ADR-0033)", async ({ page }) => {
  const k = async () => Number(/scale\(([\d.]+)\)/.exec(await transform(page))?.[1]);
  expect(await k()).toBeGreaterThanOrEqual(0.7); // first start never below the far level
  const dot = page.locator('[data-element="session:claude/s3"] .glyph');
  const d0 = (await rect(dot)).width;
  const vp = await rect(page.locator("#viewport"));
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.keyboard.down("Control");
  // stay above the atlas level (g < 0.5, ADR-0037), where single elements are no longer drawn
  for (let i = 0; i < 12 && (await k()) > 0.4; i++) await page.mouse.wheel(0, 20);
  await page.keyboard.up("Control");
  const g = (await k()) / 0.7;
  expect(g).toBeLessThan(0.6);
  expect(g).toBeGreaterThanOrEqual(0.5);
  expect((await rect(dot)).width).toBeCloseTo(d0 * g, 0);
  await dot.hover();
  const bub = page.locator('[data-element="session:claude/s3"] .bub');
  await expect(bub).toBeVisible();
  expect((await rect(bub)).width).toBeCloseTo(300, 0);
  await page.screenshot({ path: "test-results/e2e/zoomed-out.png" });
});
