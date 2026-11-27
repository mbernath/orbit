// Renders the README's screenshots and video from the demo board (demo-board.ts): `bun scripts/readme-media/capture.ts`.
// Writes docs/media/*.png (light and dark) and docs/media/tour.gif + tour.mp4. Needs ffmpeg and pngquant (Homebrew)
// on the machine that renders; they are not dependencies of Orbit.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";

const PORT = 47931;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = join(import.meta.dirname, "..", "..", "docs", "media");
const VIEW = { width: 1280, height: 800 };
// every first-run hint retired (ADR-0041), so none covers the pictures
const HINTS = JSON.stringify(["tidy", "open", "snooze", "jump", "island", "keys"]);
mkdirSync(OUT, { recursive: true });

/** starts a fresh demo board and waits until it is filled */
async function board() {
  const proc = Bun.spawn(["bun", join(import.meta.dirname, "demo-board.ts")], { env: { ...process.env, ORBIT_DEMO_PORT: String(PORT) }, stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.getReader();
  let out = "";
  while (!out.includes("ready")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`demo board exited: ${out}`);
    out += new TextDecoder().decode(value);
  }
  return proc;
}

async function open(browser: Browser, scheme: "light" | "dark", video?: string) {
  const context = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: video ? 1 : 2, colorScheme: scheme,
    ...(video ? { recordVideo: { dir: video, size: VIEW } } : {}),
  });
  await context.addInitScript((h) => localStorage.setItem("orbit.hints", h), HINTS);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('[data-frame="atlas"]').waitFor();
  await page.waitForTimeout(800); // layout and SSE settle
  return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
const dot = (page: Page, title: string) => page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: title }) }).locator("[data-dot]");

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

/** a short tour, recorded as webm, then turned into tour.mp4 and tour.gif with ffmpeg */
async function tour(browser: Browser) {
  const raw = join(tmpdir(), `orbit-tour-${Date.now()}`);
  const page = await open(browser, "light", raw);
  const pause = (ms: number) => page.waitForTimeout(ms);
  const glide = async (title: string) => {
    const box = (await dot(page, title).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  };
  await pause(1200);
  await glide("Rate limits for the public API");
  await pause(1600);
  await glide("Speed up the first map load");
  await page.mouse.down(), await page.mouse.up();
  await pause(2500);
  await page.keyboard.press("Escape");
  // N starts a session in the island under the pointer; the fake CLI asks to write a file, Allow lets it carry on
  const head = (await page.locator('[data-frame="notes"] .frame-head').boundingBox())!;
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2, { steps: 25 });
  await page.locator("#viewport").focus();
  await page.keyboard.press("n");
  await pause(600);
  await page.locator("dialog form textarea").pressSequentially("Create a file with the release notes", { delay: 40 });
  await page.keyboard.press("Enter");
  await pause(1200);
  const asking = page.locator(".glyphview", { has: page.locator(".lab-t", { hasText: "Create a file" }) });
  const allow = asking.locator(".b-perm").getByRole("button", { name: "Allow" });
  await allow.waitFor();
  await glide("Create a file");
  await pause(1200);
  const box = (await allow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await pause(400);
  await allow.click();
  await pause(1800);
  await page.mouse.move(5, 5, { steps: 15 });
  await page.locator('[data-frame="atlas"] .frame-pr').hover();
  await pause(1500);
  await glide("Roadmap");
  await page.mouse.down(), await page.mouse.up();
  await pause(2500);
  const video = page.video()!;
  await page.context().close();
  const webm = await video.path();
  const mp4 = join(OUT, "tour.mp4");
  const gif = join(OUT, "tour.gif");
  await Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", mp4]).exited;
  const filter = "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4";
  await Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-vf", filter, gif]).exited;
  rmSync(raw, { recursive: true, force: true });
}

const proc = await board();
const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"] as const) await stills(browser, scheme);
  await tour(browser);
} finally {
  await browser.close();
  proc.kill();
}
for (const f of readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
  await Bun.spawn(["pngquant", "--force", "--skip-if-larger", "--quality", "70-90", "--ext", ".png", join(OUT, f)]).exited;
}
console.log(`written to ${OUT}`);
