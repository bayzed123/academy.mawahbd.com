#!/usr/bin/env node
/**
 * One command for local development:   npm run dev
 *
 *   • creates worker/.dev.vars from the example file (fake local secrets) if you have none
 *   • builds the public-site assets and both React apps once, so the Worker can serve them
 *   • applies the D1 migrations to a LOCAL database (.wrangler/state) — first run also loads the demo seed
 *   • starts, with prefixed logs:
 *        Worker + public site     http://localhost:8787        (wrangler dev — local D1 / KV / R2, nothing leaves your machine)
 *        Student app, hot reload  http://localhost:5173/app/   (Vite, proxies /api to the Worker)
 *        Admin app, hot reload    http://localhost:5174/admin/
 *   • rebuilds the public-site CSS/JS when files in marketing/ or shared/styles/ change
 *
 * Options:   --seed    load worker/seed/dev-demo.sql again (demo lessons, a free class, coupon WELCOME10, business settings)
 *            --reset   delete the local database first (a clean slate)
 *            --worker-only   skip the two Vite dev servers
 * No Cloudflare account is needed: Stream and Workers AI are "remote-only" bindings, so the dev config drops them
 * (the chatbot then answers with its friendly hand-off message, video lessons show a notice).
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worker = resolve(root, "worker");
const args = new Set(process.argv.slice(2));
const STATE = "../.wrangler/state"; // relative to worker/
const stateDir = resolve(root, ".wrangler/state");

const color = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const say = (s) => console.log(`${color(36, "[dev]")} ${s}`);

function must(cmd, cmdArgs, cwd = root, label = `${cmd} ${cmdArgs.join(" ")}`) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(color(31, `[dev] failed: ${label}`));
    process.exit(r.status ?? 1);
  }
}

if (args.has("--reset")) {
  rmSync(stateDir, { recursive: true, force: true });
  say("local database removed");
}
const firstRun = !existsSync(stateDir);

if (!existsSync(resolve(worker, ".dev.vars"))) {
  copyFileSync(resolve(worker, ".dev.vars.example"), resolve(worker, ".dev.vars"));
  say("created worker/.dev.vars with FAKE local secrets (never commit this file)");
}

say("building public-site assets and the two React apps …");
must("node", ["scripts/gen-dev-config.mjs"]);
must("node", ["scripts/build-marketing.mjs"]);
must("npm", ["run", "build", "-w", "app", "--silent"]);
must("npm", ["run", "build", "-w", "admin", "--silent"]);

say("applying D1 migrations to the local database …");
const wr = (...a) => ["wrangler", ...a, "-c", ".wrangler.dev.toml", "--persist-to", STATE];
must("npx", wr("d1", "migrations", "apply", "DB", "--local"), worker);
if (firstRun || args.has("--seed")) {
  say("loading the demo seed (lessons, a free class, coupon WELCOME10, business settings) …");
  must("npx", wr("d1", "execute", "DB", "--local", "--file", "./seed/dev-demo.sql"), worker);
}

const children = [];
function start(name, tint, cmd, cmdArgs, cwd) {
  // each in its own process group, so shutting down also stops the servers npx starts underneath
  const child = spawn(cmd, cmdArgs, { cwd, env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const prefix = color(tint, `[${name}]`);
  const pipe = (stream, out) =>
    stream.on("data", (chunk) =>
      String(chunk)
        .split("\n")
        .filter((l) => l.trim() && !l.includes("Proxy environment variables detected"))
        .forEach((l) => out.write(`${prefix} ${l}\n`)),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      say(`${name} stopped (exit ${code}) — shutting down`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("worker", 35, "npx", ["wrangler", "dev", "-c", ".wrangler.dev.toml", "--persist-to", STATE, "--port", "8787"], worker);
if (!args.has("--worker-only")) {
  start("app  ", 34, "npx", ["vite", "--host", "127.0.0.1"], resolve(root, "app"));
  start("admin", 33, "npx", ["vite", "--host", "127.0.0.1"], resolve(root, "admin"));
}

// rebuild the public-site CSS/JS when its sources change (debounced)
let timer;
for (const dir of ["marketing", "shared/styles"]) {
  watch(resolve(root, dir), { recursive: true }, (_event, file) => {
    if (!file || /og-default|\.(woff2|jpg|png)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const r = spawnSync("node", ["scripts/build-marketing.mjs"], { cwd: root, encoding: "utf8" });
      say(r.status === 0 ? `public-site assets rebuilt (${file})` : color(31, `rebuild failed: ${r.stderr}`));
    }, 250);
  });
}

console.log(`
${color(32, "Ready.")}  Public site   http://localhost:8787        (Bangla)   http://localhost:8787/en  (English)
        Student app   http://localhost:8787/app/       (or hot-reload: http://localhost:5173/app/)
        Admin         http://localhost:8787/admin/     (or hot-reload: http://localhost:5174/admin/)
        First admin:  open the admin URL — setup token is SETUP_TOKEN in worker/.dev.vars (dev-setup-token)
        Test payments: pick "Test payment" at checkout (simulated gateway, local only)
        Ctrl+C stops everything.
`);
