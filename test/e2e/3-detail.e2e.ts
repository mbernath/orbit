// Slice 3 of the board redesign: detail panel, documents as pages, taking things off the board with undo,
// island menu and keyboard (docs/design/elements.md, interaction.md). Runs after 1- and 2-, changes data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const el = (page: Page, ref: string) => page.locator(`[data-element="${ref}"]`);
const s1 = "session:claude/s1";
const transform = (page: Page) => page.locator("#world").evaluate((w) => (w as HTMLElement).style.transform);
const panel = (page: Page) => page.locator("#panel");
/** ref and path of the pinned README */
async function readme(page: Page) {
  const state = await (await page.request.get("/api/state")).json();
  const f = state.entities.find((e: any) => e.kind === "file");
  return { ref: f.ref as string, path: f.data.path as string };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(el(page, s1)).toBeVisible();
});

test("A click on a dot opens the detail panel, the camera stays; conversation with folded steps", async ({ page }) => {
  const before = await transform(page);
  await el(page, s1).locator("[data-dot]").click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator(".p-title")).toHaveValue("Speed up transcript import");
  await expect(panel(page).locator(".p-meta")).toContainText("orbit");
  await expect(panel(page).locator(".p-foot .p-note")).toContainText("Runs outside Orbit"); // where the reply field would be
  await expect(panel(page).locator(".msg.you")).toHaveText("Make the import faster");
  await expect(panel(page).locator(".msg.ai")).toContainText("only the end");
  await expect(panel(page).locator(".steps summary")).toHaveText("2 steps");
  await expect(panel(page).locator(".msg.note")).toHaveText("Background task done: Tests passing"); // ADR-0026: not a "you" bubble
  expect(await transform(page)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("⌘C copies selected text from the conversation: the key leaves focus and selection where they are", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await el(page, s1).locator("[data-dot]").click();
  const b = (await panel(page).locator(".msg.ai strong").boundingBox())!;
  await page.mouse.move(b.x + 1, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const before = await focused();
  await page.keyboard.press("ControlOrMeta+c");
  // Safari drops the selection when the focus moves, so the board must not take the focus on ⌘C
  expect(await focused()).toBe(before);
  expect(await page.evaluate(() => String(getSelection()))).toBe("only the end");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("only the end");
});

test("The detail panel closes with × and with a click on empty space; another dot switches it", async ({ page }) => {
  await el(page, s1).locator("[data-dot]").click();
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(panel(page)).toBeHidden();
  await el(page, s1).locator("[data-dot]").click();
  await el(page, "session:claude/s3").locator("[data-dot]").click();
  await expect(panel(page).locator(".p-title")).toHaveValue("Pipeline view by stage");
  const vp = (await page.locator("#viewport").boundingBox())!;
  await page.mouse.click(vp.x + 8, vp.y + vp.height - 8);
  await expect(panel(page)).toBeHidden();
});

test("Focus without the pointer lifts the bubble; a click on empty space ends it (ADR-0012)", async ({ page }) => {
  const dot = el(page, s1);
  const vp = (await page.locator("#viewport").boundingBox())!;
  const away = () => page.mouse.move(vp.x + 8, vp.y + vp.height - 8);
  await away();
  const depth0 = Number(await dot.getAttribute("data-depth"));
  await dot.locator("[data-dot]").click();
  await away();
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(vp.x + 8, vp.y + vp.height - 8);
  await expect(dot).toHaveAttribute("data-depth", String(depth0));
});

test("Renaming in the detail panel and with F2; the name on the board follows", async ({ page }) => {
  await el(page, s1).locator("[data-dot]").click();
  const title = panel(page).locator(".p-title");
  await title.fill("Faster import");
  await title.press("Enter");
  await expect(el(page, s1).locator(".lab-t")).toHaveText("Faster import");
  await page.keyboard.press("Escape");
  await page.locator("#viewport").focus();
  await page.keyboard.press("F2");
  await expect(title).toBeFocused();
  await title.fill("");
  await title.press("Enter"); // empty: back to the automatic title
  await expect(el(page, s1).locator(".lab-t")).toHaveText("Speed up transcript import");
});

test("A document is a page with a name; edit it in the detail panel, ⌘S saves", async ({ page }) => {
  const { ref } = await readme(page);
  await expect(el(page, ref).locator(".glyph.page")).toBeVisible();
  await expect(el(page, ref).locator(".lab-t")).toHaveText("README");
  await el(page, ref).locator("[data-dot]").click();
  await expect(panel(page).locator(".p-doc h1")).toHaveText("Notes");
  await panel(page).locator(".p-doc p").click();
  const src = panel(page).locator("textarea");
  await expect(src).toBeFocused();
  await src.fill("# Notes\n\nRewritten.\n");
  await src.press("ControlOrMeta+s");
  await expect(panel(page).locator(".p-doc")).toContainText("Rewritten.");
});

test("If the file has changed meanwhile, saving asks instead of overwriting", async ({ page }) => {
  const { ref, path } = await readme(page);
  await el(page, ref).locator("[data-dot]").click();
  await panel(page).locator(".p-doc").click();
  const src = panel(page).locator("textarea");
  await src.fill("# My version\n");
  writeFileSync(path, "# Their version\n");
  await src.press("ControlOrMeta+s");
  await expect(panel(page).locator(".p-conflict")).toContainText("has changed meanwhile");
  await panel(page).getByRole("button", { name: "Save anyway" }).click();
  await expect(panel(page).locator(".p-doc h1")).toHaveText("My version");
});

test("An update without changed content leaves the document alone: the scroll position stays", async ({ page }) => {
  const { ref } = await readme(page);
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n");
  await page.clock.install();
  await page.reload();
  await el(page, ref).locator("[data-dot]").click();
  const doc = panel(page).locator(".p-doc");
  await doc.click();
  await panel(page).locator("textarea").fill(`# Long\n\n${long}\n`);
  await panel(page).locator("textarea").press("ControlOrMeta+s");
  await expect(doc).toContainText("Paragraph 80.");
  await doc.evaluate((d) => ((d.scrollTop = 400), ((d as any).__marked = true)));
  await page.clock.runFor(31_000); // the slow refresh for relative times
  await page.waitForTimeout(300);
  expect(await doc.evaluate((d) => [(d as any).__marked === true, d.scrollTop])).toEqual([true, 400]);
});

test("Delete removes from the board, the status line and ⌘Z bring it back", async ({ page }) => {
  await el(page, s1).locator("[data-dot]").click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("Delete");
  await expect(el(page, s1)).toHaveCount(0);
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("#status")).toContainText("removed from board");
  await page.locator("#status").getByRole("button", { name: "Undo" }).click();
  await expect(el(page, s1)).toBeVisible();

  await el(page, s1).locator("[data-dot]").click();
  await panel(page).getByRole("button", { name: "Remove from board" }).click();
  await expect(el(page, s1)).toHaveCount(0);
  await page.locator("#viewport").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(el(page, s1)).toBeVisible();
});

test("Island panel (ADR-0042): bring back what was removed from the board, rename, remove only when empty", async ({ page }) => {
  await el(page, s1).locator("[data-dot]").click();
  await panel(page).getByRole("button", { name: "Remove from board" }).click();
  await expect(el(page, s1)).toHaveCount(0);
  await page.locator('[data-frame="orbit"] .frame-name').click();
  await expect(panel(page).getByRole("textbox", { name: "Island name" })).toHaveValue("orbit");
  // one row in the panel; the list is its own view with a search, Esc goes back
  await expect(panel(page).getByRole("button", { name: "Speed up transcript import" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: /Removed from board · 1/ }).click();
  const search = panel(page).getByRole("textbox", { name: "Search removed sessions" });
  await expect(search).toBeFocused();
  await search.fill("nothing like it");
  await expect(panel(page)).toContainText("No matches.");
  await search.fill("transcript");
  await page.screenshot({ path: "test-results/e2e/island-removed.png" });
  await panel(page).getByRole("button", { name: /Speed up transcript import/ }).click();
  await expect(el(page, s1)).toBeVisible();
  await expect(panel(page)).toContainText("Nothing removed from this island.");
  await search.press("Escape");
  await expect(panel(page).getByRole("button", { name: "Removed from board" })).toBeDisabled();

  await expect(panel(page).getByRole("button", { name: "Remove island …" })).toBeDisabled();
  await expect(panel(page)).toContainText("from the board first.");
  await page.screenshot({ path: "test-results/e2e/island-panel.png" });

  // a double-click on the name opens the panel with the name ready to rename
  await page.locator('[data-frame="kestrel"] .frame-name').dblclick();
  const name = panel(page).getByRole("textbox", { name: "Island name" });
  await expect(name).toBeFocused();
  await name.fill("Kestrel");
  await name.press("Enter");
  await expect(page.locator('[data-frame="kestrel"] .frame-name')).toHaveText("Kestrel");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("? shows the keyboard shortcuts, Esc closes them", async ({ page }) => {
  await page.locator("#viewport").focus();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
});

test("Snooze/Seen sits top right among the detail panel's icons", async ({ page }) => {
  await page.locator('[data-element="session:claude/s3"] [data-dot]').click();
  const later = panel(page).locator(".p-head").getByRole("button", { name: "Snooze" });
  await expect(later).toBeVisible();
  await expect(panel(page).locator(".p-info").getByRole("button", { name: "Snooze" })).toHaveCount(0);
});

test("Copy buttons on hover: a bubble as Markdown, a code block on its own, also in a document", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await el(page, s1).locator("[data-dot]").click();
  const ai = panel(page).locator(".msg.ai");
  const copyMsg = ai.locator('> [data-copy="msg"]');
  await expect(copyMsg).toHaveCSS("opacity", "0");
  await ai.hover();
  await expect(copyMsg).toHaveCSS("opacity", "1");
  await copyMsg.click();
  expect(await clipboard()).toBe("The import now reads **only the end** of the file.\n\n```sh\nbun run import --tail\n```\n\nProgress bar in `#1d9e75`.");
  await expect(copyMsg).toHaveAttribute("title", "Copied");
  await ai.locator(".code").hover();
  await ai.locator('[data-copy="code"]').click();
  expect(await clipboard()).toBe("bun run import --tail\n");
  const you = panel(page).locator(".msg.you");
  await expect(you).toHaveText("Make the import faster"); // the icon is CSS, not text of the message
  await you.hover();
  await you.locator('[data-copy="msg"]').click();
  expect(await clipboard()).toBe("Make the import faster");

  const { ref } = await readme(page);
  await page.keyboard.press("Escape");
  await el(page, ref).locator("[data-dot]").click();
  await panel(page).locator(".p-doc h1").click();
  await panel(page).locator("textarea").fill("# Notes\n\n```\necho hello\n```\n");
  await panel(page).locator("textarea").press("ControlOrMeta+s");
  const code = panel(page).locator(".p-doc .code");
  await expect(code).toBeVisible();
  await code.hover();
  await code.locator('[data-copy="code"]').click();
  expect(await clipboard()).toBe("echo hello\n");
  await expect(panel(page).locator("textarea")).toHaveCount(0); // copying does not open the editor
});

test("⌘-click on a file reference opens it outside (ADR-0030), without opening the document editor", async ({ page }) => {
  const { ref, path } = await readme(page);
  const folder = path.slice(0, path.lastIndexOf("/"));
  const log = join(folder, "..", "opened.jsonl");
  await el(page, ref).locator("[data-dot]").click();
  await panel(page).locator(".p-doc h1").click();
  await panel(page).locator("textarea").fill(`# Notes\n\n[whole](file://${path}) · [line 2](README.md#L2) · \`./README.md:3\`\n`);
  await panel(page).locator("textarea").press("ControlOrMeta+s");
  const links = panel(page).locator(".p-doc a.file-link");
  await expect(links).toHaveCount(3);
  for (let i = 0; i < 3; i++) await links.nth(i).click({ modifiers: ["ControlOrMeta"] });
  await expect(panel(page).locator("textarea")).toHaveCount(0);
  await expect.poll(() => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [])).toEqual([
    ["code", "-g", path],
    ["code", "-g", `${path}:2`],
    ["code", "-g", `${path}:3`],
  ]);
});

test("A click on a file reference previews it in Orbit: code at the line, images; Open and Show in Finder (ADR-0040)", async ({ page }) => {
  const { ref, path } = await readme(page);
  const folder = path.slice(0, path.lastIndexOf("/"));
  const log = join(folder, "..", "opened.jsonl");
  const opened = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(join(folder, "src", "app.ts"), Array.from({ length: 80 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n"));
  // 1×1 PNG
  writeFileSync(join(folder, "pic.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
  await el(page, ref).locator("[data-dot]").click();
  await panel(page).locator(".p-doc h1").click();
  await panel(page).locator("textarea").fill("# Notes\n\n`src/app.ts:60` · [image](pic.png)\n");
  await panel(page).locator("textarea").press("ControlOrMeta+s");
  const links = panel(page).locator(".p-doc a.file-link");
  await expect(links).toHaveCount(2);
  const before = opened().length;

  const preview = page.locator("dialog.preview");
  await links.nth(0).click();
  await expect(preview).toBeVisible();
  await expect(preview.locator(".pv-name")).toHaveText("app.ts:60");
  await expect(preview.locator(".pv-line")).toHaveText("60const line60 = 60;");
  await expect(preview.locator(".pv-line")).toBeInViewport();
  await page.screenshot({ path: join(folder, "..", "preview-code.png") });
  await preview.locator('[data-pv="open"]').click();
  await expect(preview).toBeHidden();
  await expect.poll(() => opened().slice(before)).toEqual([["code", "-g", `${join(folder, "src", "app.ts")}:60`]]);

  await links.nth(1).click();
  await expect(preview.locator("img.pv-img")).toBeVisible();
  await expect.poll(() => preview.locator("img.pv-img").evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1);
  await preview.locator('[data-pv="reveal"]').click();
  await expect.poll(() => opened().slice(before + 1)).toEqual([["open", "-R", join(folder, "pic.png")]]);

  await links.nth(1).click();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(panel(page).locator("textarea")).toHaveCount(0);
});

test("A document's frontmatter shows as a key/value table above the text, and stays in the saved file", async ({ page }) => {
  const { ref, path } = await readme(page);
  await el(page, ref).locator("[data-dot]").click();
  await panel(page).locator(".p-doc h1").click();
  const text = "---\nname: notes\ndescription: Notes for the team\n---\n# Notes\n\nBody.\n";
  await panel(page).locator("textarea").fill(text);
  await panel(page).locator("textarea").press("ControlOrMeta+s");
  const table = panel(page).locator(".p-doc dl.frontmatter");
  await expect(table.locator("dt")).toHaveText(["name", "description"]);
  await expect(table.locator("dd").nth(1)).toHaveText("Notes for the team");
  await expect(panel(page).locator(".p-doc h1")).toHaveText("Notes");
  expect(readFileSync(path, "utf8")).toBe(text);
  if (process.env.SHOT) await panel(page).screenshot({ path: process.env.SHOT });
});

test("A colour code in the conversation shows a swatch; its popover copies the colour as rgb (ADR-0045)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await el(page, s1).locator("[data-dot]").click();
  const sw = panel(page).locator(".msg.ai button.swatch");
  await expect(sw).toHaveAttribute("title", "#1d9e75 · rgb(29, 158, 117) · hsl(161, 69%, 37%)");
  await expect(panel(page).locator(".msg.ai p code")).toHaveText("#1d9e75");
  await sw.click();
  const pop = page.locator(".color-pop");
  await expect(pop.locator("button")).toHaveText(["#1d9e75", "rgb(29, 158, 117)", "hsl(161, 69%, 37%)"]);
  await page.screenshot({ path: test.info().outputPath("color-pop.png") });
  await pop.getByRole("button", { name: "rgb(29, 158, 117)" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("rgb(29, 158, 117)");
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(panel(page)).toBeVisible(); // Escape closed the popover only
  await expect(sw).toBeFocused();
});
