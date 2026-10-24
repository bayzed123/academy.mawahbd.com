import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the REAL Worker (wrangler dev, local D1/KV/R2 — nothing leaves the machine)
 * serving the built React apps. `scripts/e2e-server.mjs` creates a fresh database, applies the migrations and
 * the dev demo seed, then starts the server on :8788.
 *
 * Local run:  npm run build && npm run test:e2e
 * In the sandbox / CI image where Chromium is preinstalled, set CHROMIUM_PATH to use it.
 */
const PORT = 8788;

// The owner account the tests create gets a random password per run; this is set before Playwright starts its worker
// process, which inherits it, so every spec file sees the same value (e2e/helpers.ts).
process.env.E2E_OWNER_PASSWORD ??= `Aa1-${randomBytes(9).toString("base64url")}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // specs share one database, so they run in order
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "bn-BD",
    // The site moves (sections rise in, buttons pulse, floating buttons bounce) only for visitors who have not asked for less motion. Every
    // spec runs as one who has: nothing waits to be shown, so each accessibility scan sees the whole page and no click waits for a move to
    // end. e2e/28-look.spec.ts turns motion on to test it; the slider's own timing test turns it on too.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--proxy-bypass-list=*"],
    },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
