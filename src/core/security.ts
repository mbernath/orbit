// Protection of the local server (ADR-0009): host check against DNS rebinding,
// origin check and tokens against requests from other web pages.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");

/** The hook token persists in ORBIT_HOME so running hooks keep working across restarts. */
export function loadHookToken(home: string) {
  const file = join(home, "hook-token");
  if (existsSync(file)) {
    const t = readFileSync(file, "utf8").trim();
    if (t) return t;
  }
  const t = randomToken();
  writeFileSync(file, t + "\n", { mode: 0o600 });
  return t;
}

export function createGuard(opts: { port: number; hookToken: string; boardToken?: string }) {
  const boardToken = opts.boardToken ?? randomToken(); // new per start; the board gets it with the page
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  return {
    boardToken,
    hostAllowed: (req: Request) => hosts.has(req.headers.get("host") ?? ""),
    /** A missing Origin is fine (curl, hooks, tests); a foreign one never is. */
    originAllowed(req: Request) {
      const origin = req.headers.get("origin");
      return !origin || origins.has(origin);
    },
    authorized(req: Request, auth: "board" | "hook" | "none") {
      if (auth === "none") return true;
      const token = req.headers.get("x-orbit-token");
      return auth === "board" ? token === boardToken : token === opts.hookToken;
    },
  };
}
