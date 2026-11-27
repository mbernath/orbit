// Renders the README's screenshots and tour from the demo board (demo-board.ts): `bun run media`.
// Writes docs/media/*.png (light and dark), then runs tour.ts for tour.gif + tour.mp4. Needs ffmpeg and pngquant
// (Homebrew) on the machine that renders; they are not dependencies of Orbit.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { board, dot, open, OUT, VIEW } from "./kit";

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });

async function stills(browser: Browser, scheme: "light" | "dark") {
  const s = scheme === "dark" ? "-dark" : "";
  const page = await open(browser, scheme);
  await page.screenshot({ path: join(OUT, `board${s}.png`), clip: { x: 0, y: 150, width: VIEW.width, height: 500 } });

  await dot(page, "Speed up the first map load").click();
  await page.locator("#panel").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `panel${s}`);
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);

  await dot(page, "Fix the flaky geocoder test").hover();
  await page.waitForTimeout(500);
  await shot(page, `waiting${s}`);

  await page.locator('[data-frame="atlas"] .frame-pr').click();
  await page.waitForTimeout(300);
  await shot(page, `prs${s}`);
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);

  await dot(page, "Roadmap").click();
  await page.locator("#panel").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `list${s}`);
  await page.context().close();
}

const { proc } = await board("stills");
const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"] as const) await stills(browser, scheme);
} finally {
  await browser.close();
  proc.kill();
  await proc.exited;
}
for (const f of readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
  await Bun.spawn(["pngquant", "--force", "--skip-if-larger", "--quality", "70-90", "--ext", ".png", join(OUT, f)]).exited;
}
await Bun.spawn(["bun", join(import.meta.dirname, "tour.ts")], { stdout: "inherit", stderr: "inherit" }).exited;
console.log(`written to ${OUT}`);
