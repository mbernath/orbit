// Shared by capture.ts (stills) and tour.ts (video): start the demo board, open it in Playwright, find dots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";

export const PORT = 47931;
export const BASE = `http://127.0.0.1:${PORT}/`;
export const OUT = join(import.meta.dirname, "..", "..", "docs", "media");
export const VIEW = { width: 1280, height: 800 };
/** the tour is recorded smaller, so the islands fill the frame */
export const TOUR_VIEW = { width: 1040, height: 600 };
// every first-run hint retired (ADR-0041), so none covers the pictures
const HINTS = JSON.stringify(["tidy", "open", "snooze", "jump", "island", "keys"]);
mkdirSync(OUT, { recursive: true });

/** starts a fresh demo board in the given scene and waits until it is filled; returns its stdout lines so far */
export async function board(scene: "stills" | "tour") {
  const proc = Bun.spawn(["bun", join(import.meta.dirname, "demo-board.ts")], {
    env: { ...process.env, ORBIT_DEMO_PORT: String(PORT), ORBIT_DEMO_SCENE: scene }, stdin: "pipe", stdout: "pipe", stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  let out = "";
  while (!out.includes("ready")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`demo board exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  return { proc, out };
}

export async function open(browser: Browser, scheme: "light" | "dark", video?: string) {
  const context = await browser.newContext({
    viewport: video ? TOUR_VIEW : VIEW, deviceScaleFactor: video ? 1 : 2, colorScheme: scheme,
    ...(video ? { recordVideo: { dir: video, size: TOUR_VIEW } } : {}),
  });
  await context.addInitScript((h) => localStorage.setItem("orbit.hints", h), HINTS);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('[data-frame="atlas"]').waitFor();
  await page.waitForTimeout(800); // layout and SSE settle
  return page;
}

export const dot = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) }).locator("[data-dot]");
