// First run (docs/design/onboarding.md, ADR-0041) against its own server: an empty data folder, three transcript
// projects. The tests run in order and build on each other: stage 1 adds the island stages 2 and 3 use.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { HOOK_EVENTS } from "../../../src/sources/claude/hook-setup";
import { EMPTY_HOME, EMPTY_PORT, folderPath } from "./fixture";

const hint = (page: Page) => page.locator("#hint");
const importLine = (page: Page) => page.locator("#import-line");
const sessions = (page: Page) => page.locator('[data-element^="session:claude/harbor-"]');
const harbor = folderPath("harbor");
/** a hook event as Claude Code's hook sends it, with the token the server wrote */
const hook = (body: object) =>
  fetch(`http://127.0.0.1:${EMPTY_PORT}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orbit-Token": readFileSync(join(EMPTY_HOME, "hook-token"), "utf8").trim() },
    body: JSON.stringify(body),
  });
/** an imported session starts waiting for a permission */
async function waiting(id: string) {
  await hook({ session_id: id, hook_event_name: "UserPromptSubmit", cwd: harbor, prompt: `Go on with ${id}` });
  await hook({ session_id: id, hook_event_name: "PermissionRequest", cwd: harbor, tool_name: "Bash", tool_input: { command: "npm test" } });
}
const shows = async (page: Page, id: string, text: string) => {
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toHaveAttribute("data-hint", id);
  await expect(hint(page)).toHaveText(text);
};

test("Stage 1: the empty board suggests the folders by last use; one click makes the island with its recent sessions, Keep lets the first hint follow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#first-run")).toBeVisible();
  await expect(page.locator(".fr-lead")).toHaveText("All your Claude Code sessions in one place — and the ones that need you.");
  const rows = page.locator(".fr-folder");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator("b")).toHaveText(["harbor", "lumen", "quill"]);
  await expect(rows.locator(".fr-meta")).toHaveText(["18 sessions, 3 this week · 1 day ago", "2 sessions, 2 this week · 3 days ago", "1 session · 8 days ago"]);
  await expect(page.locator(".fr-other")).toHaveText("Choose another folder …");
  await expect(page.locator("#empty")).toBeHidden(); // the old "No sessions yet" text is gone
  // no chrome that needs islands, and zoom input does nothing
  for (const c of [".chrome", ".minimap", ".edges"]) await expect(page.locator(`#viewport ${c}`)).toBeHidden();
  const zoom = () => page.evaluate(() => document.querySelector("#world")?.getAttribute("style"));
  const before = await zoom();
  await page.locator("#viewport").focus();
  await page.keyboard.press("+");
  await page.mouse.move(200, 200);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  expect(await zoom()).toBe(before);
  await page.screenshot({ path: "test-results/e2e/onboarding-stage1.png" });
  await page.locator(".fr-other").click(); // the existing new-island form
  await expect(page.locator("dialog .dlg-title")).toHaveText("New island");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);

  await page.evaluate(() => ((window as any).__sameDocument = true));
  await rows.first().click();
  await expect(page.locator('[data-frame="harbor"]')).toBeVisible();
  await expect(page.locator("#first-run")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true); // no reload

  // stage 1b: only this week's three stay; the line says what happened
  await expect(sessions(page)).toHaveCount(3);
  for (const id of ["harbor-1", "harbor-2", "harbor-3"]) await expect(page.locator(`[data-element="session:claude/${id}"]`)).toBeVisible();
  await expect(importLine(page)).toBeVisible();
  await expect(importLine(page)).toHaveText("3 recent sessions · 15 older ones kept off the board — Keep · Show all · Show none");
  await expect(importLine(page)).toHaveCSS("background-color", "rgb(251, 232, 243)");
  await expect(hint(page)).toBeHidden(); // the line is the guide while it shows: no hint beside it
  // the fit leaves room for the no-hook line at the top: the island starts below it
  const notice = await page.locator("#hook-notice").boundingBox();
  const frame = await page.locator('[data-frame="harbor"]').boundingBox();
  expect(notice && frame && frame.y > notice.y + notice.height).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/e2e/onboarding-import-line.png" });
  // Keep: the default is fine, the line goes and the first hint follows at once
  await importLine(page).getByRole("button", { name: "Keep" }).click();
  await expect(importLine(page)).toBeHidden();
  await expect(sessions(page)).toHaveCount(3);
  await shows(page, "open", "Enter or click opens it");
  // an anchored callout: a notch toward the session, a guide ring around its dot
  await expect(hint(page)).toHaveAttribute("data-side", /^(left|right|above|below)$/);
  // never over another session's name: here "Work on harbor 2" sits right of harbor 1's name
  const pill = (await hint(page).boundingBox())!;
  for (const lab of await page.locator("[data-element^='session:claude/harbor-'] .lab").all()) {
    const b = (await lab.boundingBox())!;
    expect(pill.x < b.x + b.width && pill.x + pill.width > b.x && pill.y < b.y + b.height && pill.y + pill.height > b.y).toBe(false);
  }
  expect(await hint(page).evaluate((el) => getComputedStyle(el, "::after").content)).not.toBe("none");
  await expect(page.locator(".guide-halo")).toHaveCount(1);
  await expect(page.locator("[data-element^='session:claude/harbor-'] [data-dot].guide-halo")).toHaveCount(1);
  await page.waitForTimeout(3400); // the pulse is over, the still ring stays
  await page.screenshot({ path: "test-results/e2e/onboarding-after-keep.png" });
});

test("Stage 2: an island but no hook: a quiet line with the install command, gone once the hook is installed", async ({ page }) => {
  await page.goto("/");
  const line = page.locator("#hook-notice");
  await expect(line).toBeVisible();
  await expect(line).toHaveClass(/quiet/);
  await expect(line).toHaveText("Live status needs Claude Code's hook. In the Orbit folder, run bun run hooks:install, then restart Claude sessions.");
  await page.screenshot({ path: "test-results/e2e/onboarding-stage2.png" });
  const orbitHook = [{ hooks: [{ type: "command", command: "/x/orbit/hooks/orbit-hook.sh" }] }];
  writeFileSync(join(EMPTY_HOME, "settings.json"), JSON.stringify({ hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, orbitHook])) }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); // the user comes back from the terminal
  await expect(line).toBeHidden();
});

test("Stage 3: the hints of the table, one at a time, each gone after its action and after a reload", async ({ page }) => {
  await page.goto("/?hints=reset");
  const dot = (id: string) => page.locator(`[data-element="session:claude/${id}"] [data-dot]`);
  await expect(dot("harbor-1")).toBeVisible();

  await shows(page, "open", "Enter or click opens it");
  await dot("harbor-1").click();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(hint(page)).not.toHaveAttribute("data-hint", "open");

  await waiting("harbor-1");
  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();
  await shows(page, "snooze", "⌘⇧S snoozes · Space replies");
  // a pill in the guide colour, reserved for onboarding (onboarding.md "Look")
  await expect(hint(page)).toHaveCSS("background-color", "rgb(251, 232, 243)");
  await expect(hint(page)).toHaveCSS("color", "rgb(192, 57, 143)");
  await page.waitForTimeout(3400); // fade-in and pulse are over: the still ring
  await page.screenshot({ path: "test-results/e2e/onboarding-hint.png" });
  await dot("harbor-1").hover();
  await page.keyboard.press("ControlOrMeta+Shift+KeyS"); // ADR-0043: S alone is no key any more
  await expect(hint(page)).not.toHaveAttribute("data-hint", "snooze");

  await waiting("harbor-2");
  await waiting("harbor-3");
  await shows(page, "jump", "W jumps to the next one that needs you");
  await page.mouse.move(5, 5);
  await page.keyboard.press("w");
  await expect(hint(page)).not.toHaveAttribute("data-hint", "jump");

  await shows(page, "island", "Add a session, agent, file or list");
  await expect(hint(page)).toHaveAttribute("data-side", "above");
  await expect(page.locator("#world .frame-add.guide-halo")).toHaveCount(1);
  await page.locator('[data-island-menu="harbor"]').click();
  await expect(page.locator(".menu")).toBeVisible();
  await expect(hint(page)).toBeHidden(); // never while a menu is open
  await page.keyboard.press("Escape");

  await shows(page, "keys", "? all keys");
  await expect(page.locator("#viewport .chrome.guide-halo")).toHaveCount(1);
  await page.keyboard.press("?");
  await expect(page.locator(".shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hint(page)).toBeHidden();
  await expect(page.locator(".guide-halo")).toHaveCount(0); // the ring goes with the hint

  await page.reload(); // the URL no longer carries ?hints=reset
  expect(new URL(page.url()).search).toBe("");
  await expect(dot("harbor-1")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(hint(page)).toBeHidden();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("orbit.hints"))) ?? "[]").sort()).toEqual(["island", "jump", "keys", "open", "snooze"]);

  // ADR-0043: ⌘⇧S also works in the panel, even while typing in it; its tooltip says so, the bubble's too
  await dot("harbor-2").click();
  const later = page.locator("#panel .p-head").getByRole("button", { name: "Snooze" });
  await expect(later).toHaveAttribute("title", "Snooze (⌘⇧S)");
  await page.locator("#panel .p-title").focus();
  await page.keyboard.press("ControlOrMeta+Shift+KeyS");
  await expect(later).toHaveCount(0); // snoozed: nothing left to snooze
  await expect(page.locator("#panel .p-title")).toBeFocused(); // the typing place keeps the focus
  await expect(page.locator('#panel .p-title')).not.toHaveValue(/S$/); // and got no letter
});

test("Stage 1b: Show all brings the older ones back, Show none removes the recent ones too; the line goes", async ({ page, request }) => {
  // start over with harbor: everything back on the board, then the island goes, so the first-run screen offers it again
  const act = (id: string, input: object) =>
    request.post(`/api/actions/${id}`, { headers: { "X-Orbit-Token": "e2e-board-token" }, data: { input } });
  async function fresh() {
    const state = await (await request.get("/api/state")).json();
    const refs = state.entities.filter((e: { kind: string; workspaceId: string }) => e.kind === "session" && e.workspaceId === "harbor").map((e: { ref: string }) => e.ref);
    expect((await act("canvas.archive", { refs, archived: false })).ok()).toBe(true);
    expect((await act("workspaces.remove", { id: "harbor" })).ok()).toBe(true);
    await page.goto("/");
    await page.locator(".fr-folder", { hasText: "harbor" }).click();
    await expect(importLine(page)).toContainText("3 recent sessions · 15 older ones kept off the board");
  }
  await fresh();
  await importLine(page).getByRole("button", { name: "Show all" }).click();
  await expect(sessions(page)).toHaveCount(18);
  await expect(importLine(page)).toBeHidden();
  await page.locator("#status").getByRole("button", { name: "Undo" }).click(); // undoable like other removals
  await expect(sessions(page)).toHaveCount(3);

  await fresh();
  await importLine(page).getByRole("button", { name: "Show none" }).click();
  await expect(importLine(page)).toBeHidden();
  await expect(sessions(page)).toHaveCount(0);
  await expect(page.locator("#status")).toContainText("3 removed from board");
});
