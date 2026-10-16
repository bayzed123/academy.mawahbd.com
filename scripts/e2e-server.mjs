#!/usr/bin/env node
/**
 * Starts an isolated, freshly-seeded Worker for the Playwright tests (port 8788, state in .wrangler/e2e).
 * Local-only bindings: the generated dev config drops the remote-only Stream / Workers AI bindings, and the dev
 * demo seed adds lessons, a free class, a coupon and business settings. No Cloudflare account is touched.
 */
import { generateKeyPairSync } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(root, "worker");
const state = "../.wrangler/e2e";
const PORT = process.env.E2E_PORT ?? "8788";

const config = ".wrangler.e2e.toml";
const run = (cmd, args, cwd = worker, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`e2e-server: "${cmd} ${args.join(" ")}" failed`);
    process.exit(r.status ?? 1);
  }
};

rmSync(resolve(root, ".wrangler/e2e"), { recursive: true, force: true });
if (!existsSync(resolve(worker, ".dev.vars"))) copyFileSync(resolve(worker, ".dev.vars.example"), resolve(worker, ".dev.vars"));
// SITE_URL must match the port the browser uses: payment gateways and emails redirect back to it
run("node", ["../scripts/gen-dev-config.mjs"], worker, { DEV_SITE_URL: `http://localhost:${PORT}`, DEV_CONFIG_OUT: `worker/${config}`, DEV_RATE_LIMIT_MULT: "50" });
const wr = (...a) => ["wrangler", ...a, "-c", config, "--persist-to", state];
run("npx", wr("d1", "migrations", "apply", "DB", "--local"));
run("npx", wr("d1", "execute", "DB", "--local", "--file", "./seed/dev-demo.sql"));

// Admin → Analytics reads Google Analytics with a service-account key. The tests use a made-up key, generated here for this run only (it is
// handed to the Worker and kept nowhere else) and a stand-in for Google that the Worker itself serves (worker/src/routes/api/dev-google.ts).
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const googleKey = JSON.stringify({
  type: "service_account",
  project_id: "mawah-e2e",
  private_key_id: "e2e",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  client_email: "reader@mawah-e2e.iam.gserviceaccount.com",
  client_id: "1",
});

const server = spawn(
  "npx",
  ["wrangler", "dev", "-c", config, "--persist-to", state, "--port", PORT, "--ip", "127.0.0.1", "--inspector-port", "9331", "--var", `GA4_SERVICE_ACCOUNT_JSON:${googleKey}`, "--var", `GOOGLE_API_BASE:http://127.0.0.1:${PORT}/api/dev/google`, "--var", "ANALYTICS_DEV:true"],
  {
    cwd: worker,
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  },
);
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
