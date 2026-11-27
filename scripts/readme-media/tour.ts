// The README's tour (docs/media/tour.gif + tour.mp4): a calm board, then exactly two things that need you, each one
// answered where it shows up. Captions and a visible pointer are drawn into the page only for the recording.
// Run on its own with `bun scripts/readme-media/tour.ts`, or through `bun run media`.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { board, dot, open, OUT } from "./kit";

const { proc, out } = await board("tour");
const owned = /owned (\S+)/.exec(out)?.[1] ?? "";
/** one step for the demo board: a hook event or a board action */
const send = (step: object) => (proc.stdin.write(`${JSON.stringify(step)}\n`), proc.stdin.flush());

/** a caption pill at the bottom and a dot that follows the pointer */
async function overlay(page: Page) {
  await page.evaluate(() => {
    const css = document.createElement("style");
    css.textContent = `
      #tour-cap { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%); z-index: 99999; padding: 12px 22px;
        border-radius: 999px; background: rgba(28,28,28,.88); color: #fff; font: 500 19px/1.3 system-ui, sans-serif;
        transition: opacity .5s; opacity: 0; pointer-events: none; white-space: nowrap; }
      #tour-ptr { position: fixed; z-index: 99999; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
        background: rgba(40,40,40,.35); border: 2px solid rgba(255,255,255,.9); box-shadow: 0 1px 4px rgba(0,0,0,.3);
        pointer-events: none; transition: transform .15s; left: -50px; top: -50px; }
      #tour-ptr.down { transform: scale(.7); }`;
    document.head.append(css);
    const cap = Object.assign(document.createElement("div"), { id: "tour-cap" });
    const ptr = Object.assign(document.createElement("div"), { id: "tour-ptr" });
    document.body.append(cap, ptr);
    document.addEventListener("mousemove", (e) => Object.assign(ptr.style, { left: `${e.clientX}px`, top: `${e.clientY}px` }), true);
    addEventListener("mousedown", () => ptr.classList.add("down"), true);
    addEventListener("mouseup", () => ptr.classList.remove("down"), true);
  });
}

const browser = await chromium.launch();
const raw = join(tmpdir(), `orbit-tour-${Date.now()}`);
try {
  const page = await open(browser, "light", raw);
  await overlay(page);
  const pause = (ms: number) => page.waitForTimeout(ms);
  const caption = async (text: string, ms: number) => {
    await page.evaluate((t) => {
      const cap = document.getElementById("tour-cap")!;
      cap.textContent = t;
      cap.style.opacity = t ? "1" : "0";
    }, text);
    await pause(ms);
  };
  const glideTo = async (box: { x: number; y: number; width: number; height: number }) =>
    page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 45 });
  const click = async () => (await page.mouse.down(), await pause(150), await page.mouse.up());

  await page.mouse.move(900, 420);
  await caption("Four sessions at work in three projects.", 3000);
  await caption("Nothing needs you — so you don't have to look.", 3500);

  send({ hook: { session_id: "a1", hook_event_name: "Stop", last_assistant_message: "Tiles now load in parallel; first paint went from 2.4 s to 0.6 s." } });
  await caption("", 900);
  await caption("One finishes: its dot turns orange.", 3500);

  send({ act: ["owned.send", { id: owned, text: "Now write the long file with the release notes" }] });
  await caption("", 900);
  await caption("Another needs your permission.", 3500);

  await caption("Answer it right on the board …", 600);
  // the bubble changes while the pointer is on the dot, so point at the dot first, then find Allow in what shows
  await glideTo((await dot(page, "Draft the beta announcement").boundingBox())!);
  await pause(900);
  const allow = page.locator(".glyphview").getByRole("button", { name: "Allow", exact: true }).first();
  await glideTo((await allow.boundingBox())!);
  await pause(400);
  await allow.click();
  await caption("… and it carries on.", 3000);

  await caption("Read what the other one did.", 400);
  await glideTo((await dot(page, "Speed up the first map load").boundingBox())!);
  await pause(400);
  await click();
  await pause(3500);
  const seen = page.locator("#panel").getByRole("button", { name: "Seen" });
  await glideTo((await seen.boundingBox())!);
  await pause(600);
  await click();
  await pause(800);
  await page.keyboard.press("Escape");
  await page.mouse.move(900, 420, { steps: 30 });
  await caption("Nothing needs you again.", 4000);

  const video = page.video()!;
  await page.context().close();
  const webm = await video.path();
  await Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", join(OUT, "tour.mp4")]).exited;
  const filter = "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  await Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-vf", filter, join(OUT, "tour.gif")]).exited;
} finally {
  await browser.close();
  proc.kill();
  rmSync(raw, { recursive: true, force: true });
}
