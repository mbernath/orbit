// Slice 4: sessions Orbit runs itself (ADR-0019), against the fake CLI in fake-claude.ts. Runs after 1- to 3-.
import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.locator("#panel");
const session = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) });

/** N on the board opens "New session" in the island under the pointer; the folder must exist (notes) */
async function startSession(page: Page, text: string) {
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  const form = page.locator("dialog form");
  await expect(page.locator("dialog .dlg-title")).toContainText("New session in");
  await form.locator('select[name="cwd"]').selectOption({ label: (await form.locator('select[name="cwd"] option').last().textContent()) ?? "" });
  await expect(form.locator('select[name="model"] option:checked')).toHaveText("Default");
  await expect(form.locator('select[name="effort"] option:checked')).toHaveText("medium"); // from Claude's settings (ADR-0025)
  await form.locator('select[name="model"]').selectOption("haiku");
  const started = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.start"));
  await form.locator("textarea").fill(text);
  await form.locator("textarea").press("Enter");
  expect((await started).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-frame="orbit"]')).toBeVisible();
});

test("N starts an owned session: it has a ring and speaks in its bubble", async ({ page }) => {
  await startSession(page, "Tidy up the tests");
  const dot = session(page, "Tidy up the tests");
  await expect(dot).toHaveClass(/owned/);
  await dot.locator("[data-dot]").hover();
  await expect(dot.locator(".b-said")).toHaveText("On it.");
});

test("A permission request turns the dot orange; Allow in the bubble lets it carry on", async ({ page }) => {
  await startSession(page, "Create a file");
  const dot = session(page, "Create a file");
  await expect(dot).toHaveClass(/g-waiting/);
  await expect(dot.locator(".b-perm")).toContainText("Allow Write");
  await dot.locator("[data-dot]").hover(); // hovering keeps the bubble and its corner (ADR-0012)
  await dot.locator(".b-perm").getByRole("button", { name: "Allow" }).click();
  await expect(dot.locator(".b-said")).toHaveText("Done.");
  await expect(dot).not.toHaveClass(/g-waiting/);
});

test("Replying in the detail panel; model and effort can be chosen", async ({ page }) => {
  await startSession(page, "Write the docs");
  const dot = session(page, "Write the docs");
  await dot.locator("[data-dot]").click();
  const reply = panel(page).getByRole("textbox", { name: "Reply" });
  await expect(reply).toBeVisible();
  await expect(panel(page).getByRole("combobox", { name: "Model" })).toHaveValue("haiku");
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.send"));
  await reply.fill("Carry on");
  await reply.press("Enter");
  expect((await sent).status()).toBe(200);
  await expect(reply).toHaveValue("");
  const configured = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.configure"));
  await panel(page).getByRole("combobox", { name: "Effort" }).selectOption("high");
  expect((await configured).status()).toBe(200);
  await expect(panel(page).getByRole("combobox", { name: "Effort" })).toHaveValue("high");
  const mode = page.waitForRequest((r) => r.url().endsWith("/api/actions/owned.configure"));
  await panel(page).getByRole("combobox", { name: "Mode", exact: true }).selectOption({ label: "Accept edits" });
  expect((await mode).postDataJSON().input.mode).toBe("acceptEdits");
  await expect(panel(page).getByRole("combobox", { name: "Mode", exact: true }).locator("option")).toHaveText(["Ask first", "Accept edits", "Auto", "Plan mode"]);
});

test("Taking over an observed session: a warning first, then there is a reply field", async ({ page }) => {
  await page.locator('[data-element="session:claude/s3"] [data-dot]').click();
  await expect(panel(page).getByRole("textbox", { name: "Reply" })).toHaveCount(0);
  // the take-over row sits where the reply field would be: the bottom of the panel, as wide as the field
  const row = panel(page).locator(".p-foot .p-observed");
  await expect(row).toContainText("Runs outside Orbit — take it over to reply here.");
  await expect(row.getByRole("button", { name: "Take over …" })).toBeVisible();
  const foot = (await panel(page).locator(".p-foot").boundingBox())!, box = (await panel(page).boundingBox())!;
  expect(foot.y + foot.height).toBeGreaterThan(box.y + box.height - 2);
  await page.screenshot({ path: "test-results/e2e/observed-takeover.png" });
  await panel(page).getByRole("button", { name: "Take over …" }).click();
  await expect(panel(page).locator(".p-foot .p-confirm")).toContainText("two programs on one session lose messages");
  await panel(page).getByRole("button", { name: "Take over", exact: true }).click();
  await expect(panel(page).getByRole("textbox", { name: "Reply" })).toBeVisible();
  await expect(page.locator('[data-element="session:claude/s3"]')).toHaveClass(/owned/);
});

test("Attachment in the reply field: pick, see as a chip, remove, send along", async ({ page }) => {
  await session(page, "Write the docs").locator("[data-dot]").click();
  const pick = panel(page).getByLabel("Attach file");
  await pick.setInputFiles([
    { name: "screen.png", mimeType: "image/png", buffer: Buffer.from("png-bytes") },
    { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);
  await expect(panel(page).locator(".att-chip")).toHaveCount(2);
  await panel(page).getByRole("button", { name: "Remove note.txt" }).click();
  await expect(panel(page).locator(".att-chip")).toHaveCount(1);

  const sent = page.waitForRequest((r) => r.url().endsWith("/api/actions/owned.send"));
  const reply = panel(page).getByRole("textbox", { name: "Reply" });
  await reply.fill("Here is the screenshot");
  await reply.press("Enter");
  const input = (await sent).postDataJSON().input;
  expect(input.text).toBe("Here is the screenshot");
  expect(input.attachments).toEqual([{ name: "screen.png", type: "image/png", data: Buffer.from("png-bytes").toString("base64") }]);
  await expect(panel(page).locator(".att-chip")).toHaveCount(0);
});

test("A reply shows in the conversation at once, marked as “sending”", async ({ page }) => {
  await session(page, "Write the docs").locator("[data-dot]").click();
  const reply = panel(page).getByRole("textbox", { name: "Reply" });
  await reply.fill("And the table too");
  await reply.press("Enter");
  await expect(panel(page).locator(".msg.you.pending").last()).toHaveText("And the table too");
  await expect(reply).toHaveValue("");
});

test("A draft in the reply field survives closing, and a reload too", async ({ page }) => {
  await session(page, "Write the docs").locator("[data-dot]").click();
  await panel(page).getByRole("textbox", { name: "Reply" }).fill("half written");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await page.reload();
  await session(page, "Write the docs").locator("[data-dot]").click();
  await expect(panel(page).getByRole("textbox", { name: "Reply" })).toHaveValue("half written");
});

test("Text on the canvas cannot be selected by accident, in the detail panel it can", async ({ page }) => {
  await session(page, "Write the docs").locator("[data-dot]").click();
  expect(await page.locator("#viewport .lab-t").first().evaluate((n) => getComputedStyle(n).userSelect)).toBe("none");
  expect(await panel(page).locator(".p-meta").evaluate((n) => getComputedStyle(n).userSelect)).toBe("text");
});

test("In the detail panel the question and model/mode sit above the reply field, the paper clip inside it", async ({ page }) => {
  await startSession(page, "Add a file in the panel");
  const dot = session(page, "Add a file in the panel");
  await expect(dot).toHaveClass(/g-waiting/);
  await dot.locator("[data-dot]").click();
  const foot = panel(page).locator(".p-foot");
  await expect(foot.locator(".p-ask .b-perm")).toContainText("Allow Write");
  await expect(panel(page).locator(".p-info .b-perm, .p-info .p-run")).toHaveCount(0);
  const y = (sel: string) => foot.locator(sel).evaluate((n) => n.getBoundingClientRect().top);
  expect(await y(".p-ask")).toBeLessThan(await y(".p-opts"));
  expect(await y(".p-opts")).toBeLessThan(await y(".p-reply"));
  await expect(foot.locator(".composer .att-pick")).toHaveCount(1);
  await expect(foot.getByRole("combobox", { name: "Effort" }).locator("option:checked")).toHaveText("medium");
  await foot.locator(".b-perm").getByRole("button", { name: "Allow" }).click();
  await expect(foot.locator(".b-perm")).toHaveCount(0);
});

test("After “Allow” the question disappears at once, even while Claude keeps working for long", async ({ page }) => {
  await startSession(page, "Write a long file");
  const dot = session(page, "Write a long file");
  await expect(dot).toHaveClass(/g-waiting/);
  await dot.locator("[data-dot]").hover();
  await dot.locator(".b-perm").getByRole("button", { name: "Allow" }).click();
  await expect(dot).toHaveClass(/g-working/);
  await expect(dot.locator(".b-perm")).toHaveCount(0);
  await expect(dot).not.toContainText("needs your permission");
  await expect(dot.locator(".b-said")).toHaveCount(0); // it works: no old statement either
});

test("Session defaults: follow Claude's settings until the island sets something itself", async ({ page }) => {
  // in the island panel (ADR-0042), saved on change
  await page.locator('[data-frame="kestrel"] .frame-name').click();
  const p = page.locator("#panel");
  await expect(p.getByRole("combobox", { name: "Effort" }).locator("option:checked")).toHaveText("medium");
  await expect(p.getByRole("combobox", { name: "Model" }).locator("option:checked")).toHaveText("Default");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/actions/owned.setDefaults"));
  await p.getByRole("combobox", { name: "Model" }).selectOption("haiku");
  expect((await saved).status()).toBe(200);
  await page.keyboard.press("Escape");

  await page.locator('[data-frame="kestrel"] .frame-head').hover();
  await page.locator('[data-island-menu="kestrel"]').click();
  await page.locator(".menu").getByRole("button", { name: /New session …/ }).click();
  const form = page.locator("dialog form");
  await expect(form.locator('select[name="model"] option:checked')).toHaveText("Haiku");
  await expect(form.locator('select[name="effort"] option:checked')).toHaveText("medium");
});

test("ADR-0028: a click on an option in the bubble answers Claude's question", async ({ page }) => {
  await startSession(page, "Ask me for a colour");
  const dot = session(page, "Ask me for a colour");
  await expect(dot).toHaveClass(/g-waiting/);
  await expect(dot.locator(".b-ask .b-permq")).toHaveText("Question: Which colour?");
  await dot.locator("[data-dot]").hover(); // hovering keeps the bubble (ADR-0012)
  await page.waitForTimeout(300);
  const box = (await dot.locator("[data-dot]").boundingBox())!;
  await page.screenshot({ path: "test-results/e2e/question.png", clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: 420, height: 260 } });
  await dot.locator(".b-ask").getByRole("button", { name: "Blue" }).click();
  await expect(dot.locator(".b-said")).toHaveText("You chose Blue.");
});

test("ADR-0028: giving an answer of one's own in the detail panel; a plan shows in full and can be rejected with feedback", async ({ page }) => {
  await startSession(page, "Another colour please");
  const dot = session(page, "Another colour please");
  await dot.locator("[data-dot]").click();
  const ask = panel(page).locator(".p-ask .b-ask");
  await ask.getByLabel("Other answer").fill("Green");
  const answered = page.waitForRequest((r) => r.url().endsWith("/api/actions/owned.answer"));
  await ask.getByRole("button", { name: "Answer" }).click();
  expect((await answered).postDataJSON().input.answers).toEqual({ "Which colour?": "Green" });
  await expect(panel(page).locator(".p-ask .b-ask")).toHaveCount(0);
  await page.keyboard.press("Escape"); // closes the panel
  await page.keyboard.press("Escape"); // ends the selection: its bubble may otherwise cover the island head
  await page.mouse.move(5, 5); // and no hover either

  await startSession(page, "Make a plan");
  const plan = session(page, "Make a plan");
  await plan.locator("[data-dot]").click();
  const block = panel(page).locator(".p-ask .b-ask");
  await expect(block.locator(".b-plantext h1")).toHaveText("Speed up the import");
  await block.getByLabel("Plan feedback").fill("Measure first");
  await page.waitForTimeout(300);
  await panel(page).screenshot({ path: "test-results/e2e/plan.png" });
  const rejected = page.waitForRequest((r) => r.url().endsWith("/api/actions/owned.answer"));
  await block.getByRole("button", { name: "Reject" }).click();
  expect((await rejected).postDataJSON().input).toMatchObject({ allow: false, message: "Measure first" });
  await expect(panel(page).locator(".p-ask .b-ask")).toHaveCount(0);
});

test("N creates in the island under the pointer, even when an element of another island has the focus", async ({ page }) => {
  await session(page, "Pipeline view by stage").locator("[data-dot]").click(); // kestrel element in the panel
  await page.keyboard.press("Escape");
  await page.locator('[data-frame="orbit"] .frame-head').hover();
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  await expect(page.locator("dialog .dlg-title")).toHaveText("New session in orbit");
  await expect(page.locator('[data-frame="orbit"]')).toHaveClass(/target/);
  await expect(page.locator('[data-frame="kestrel"]')).not.toHaveClass(/target/);
  await page.screenshot({ path: "test-results/e2e/n-target.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-frame="orbit"]')).not.toHaveClass(/target/);
});

test("There is always exactly one active island; it follows the pointer and W, N starts there", async ({ page }) => {
  const hot = page.locator(".frame.hot");
  await page.locator('[data-frame="kestrel"] .frame-head').hover();
  await expect(hot).toHaveCount(1);
  await expect(hot).toHaveAttribute("data-frame", "kestrel");
  await page.locator("#viewport").focus();
  // W goes to the next session that needs the user; at least one of them lies in orbit
  for (let i = 0; i < 6 && (await hot.getAttribute("data-frame")) !== "orbit"; i++) await page.keyboard.press("w");
  await expect(hot).toHaveCount(1);
  await expect(hot).toHaveAttribute("data-frame", "orbit");
  await page.keyboard.press("n");
  await expect(page.locator("dialog .dlg-title")).toHaveText("New session in orbit");
});
