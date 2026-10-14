import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/*
 * scripts/smoke-live.mjs looks at the live site after a deploy the way a visitor and a search engine meet it. Here it looks at
 * stand-in sites on localhost: one that is right in every way, and ones that go wrong in exactly one way each, so every
 * kind of mistake is shown to end in a ✗ with a plain sentence — and the right site in a clean pass.
 */
const script = fileURLToPath(new URL("../smoke-live.mjs", import.meta.url));

const SECURITY = {
  "content-security-policy": "default-src 'none'; script-src 'self'",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

/** a stand-in for the site. `fault` switches off one thing that should be there (or adds one that should not) */
async function standIn(fault = {}) {
  let origin = "";
  let hits = 0;
  const html = (path, extra = "") => `<!doctype html><html lang="bn"><head><link rel="canonical" href="${fault.canonical ?? origin}${path}"/></head><body><a href="/courses/beginners-baking-class">x</a>${extra}</body></html>`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, type = "text/html; charset=utf-8", headers = {}) => {
      res.writeHead(status, { "content-type": type, ...(fault.noHeaders ? {} : SECURITY), ...headers });
      res.end(body);
    };
    if (url.pathname === "/api/health") {
      hits++;
      if (fault.downFor && hits <= fault.downFor) return send(525, "SSL handshake failed", "text/plain");
      if (fault.neverUp) return send(502, "Bad gateway", "text/plain");
      return send(200, JSON.stringify({ ok: true, status: "up", env: "production" }), "application/json");
    }
    if (url.pathname === "/") return send(200, html("/", fault.rocket ? '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="x"></script>' : ""), undefined, fault.robotsTag ? { "x-robots-tag": "noindex" } : {});
    if (url.pathname === "/en") return send(200, html("/en"));
    if (url.pathname === "/courses") return send(200, '<a href="/courses/beginners-baking-class">Beginners</a>');
    if (url.pathname === "/api/courses") return send(200, JSON.stringify({ ok: true, courses: fault.noCourses ? [] : [{ id: 1 }] }), "application/json");
    if (url.pathname === "/app/" || url.pathname === "/admin/") return send(200, '<div id="root"></div>');
    if (url.pathname === "/robots.txt") return send(200, fault.closedRobots ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`, "text/plain");
    if (url.pathname === "/sitemap.xml") return send(200, `<urlset><url><loc>${origin}/</loc></url>${fault.freeInMap ? "<url><loc>https://x.workers.dev/</loc></url>" : ""}</urlset>`, "application/xml");
    return send(404, "not found", "text/plain");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => server.close() };
}

/** a stand-in for an address that should redirect to `to` (http, www) or work but stay out of search results (free) */
async function redirector(to, { status = 301, wrong = false } = {}) {
  const server = createServer((req, res) => {
    if (wrong) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<p>I am the site</p>");
    }
    res.writeHead(status, { location: `${to}${req.url}` });
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function free({ noindex = true, closedRobots = true } = {}) {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/health")) {
      res.writeHead(200, { "content-type": "application/json", ...(noindex ? { "x-robots-tag": "noindex, nofollow" } : {}) });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(closedRobots ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function run(args, env = {}) {
  const r = await promisify(execFile)(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env } }).then(
    (x) => ({ ...x, code: 0 }),
    (e) => ({ stdout: e.stdout, stderr: e.stderr, code: e.code }),
  );
  return r;
}

const quick = ["--wait", "1", "--every", "0.2"];

test("a site that is right in every way passes, www/http/free address included", async () => {
  const site = await standIn();
  const www = await redirector(site.origin);
  const http = await redirector(site.origin);
  const free_ = await free();
  try {
    const r = await run([site.origin, "--www", www.origin, "--http", http.origin, "--free", free_.origin, ...quick]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /All checks passed/);
    assert.match(r.stdout, /Plain http: sent on to /);
    assert.match(r.stdout, /www name .*sent on to /);
    assert.match(r.stdout, /still works and is marked noindex/);
  } finally {
    for (const s of [site, www, http, free_]) s.close();
  }
});

test("it waits for a new domain to come up (certificate and DNS take a few tries) and then passes", async () => {
  const site = await standIn({ downFor: 3 });
  try {
    const r = await run([site.origin, "--wait", "20", "--every", "0.1"]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /not ready yet \(attempt 1\): HTTP 525/);
    assert.match(r.stdout, /answers \(after .*, 4 tries\)/);
  } finally {
    site.close();
  }
});

test("a domain that never answers ends in one plain sentence, not a stack trace", async () => {
  const site = await standIn({ neverUp: true });
  try {
    const r = await run([site.origin, ...quick]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /did not answer after .*last: HTTP 502/);
    assert.match(r.stdout, /the free address keeps working/);
    assert.doesNotMatch(r.stdout + r.stderr, /at .*node:internal/);
  } finally {
    site.close();
  }
});

test("a name that nobody listens on is reported as no connection", async () => {
  const r = await run(["http://127.0.0.1:9", ...quick]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /no connection/);
});

const faults = [
  [{ canonical: "https://academy-x.workers.dev" }, /the canonical link is not/],
  [{ closedRobots: true }, /robots\.txt: .*closes the whole site/],
  [{ freeInMap: true }, /sitemap\.xml: .*mentions workers\.dev/],
  [{ robotsTag: true }, /marked “noindex” for search engines/],
  [{ rocket: true }, /Rocket Loader rewrote the page/],
  [{ noHeaders: true }, /no strict Content-Security-Policy.*no X-Content-Type-Options/],
  [{ noCourses: true }, /Class data .*0 class returned/],
];
for (const [fault, expected] of faults) {
  test(`it catches: ${Object.keys(fault)[0]}`, async () => {
    const site = await standIn(fault);
    try {
      const r = await run([site.origin, ...quick]);
      assert.equal(r.code, 1, r.stdout);
      assert.match(r.stdout, expected);
      assert.match(r.stdout, /\d+ checks? failed/);
    } finally {
      site.close();
    }
  });
}

test("http that does not redirect, a www that does not redirect and a free address that can be indexed are all caught", async () => {
  const site = await standIn();
  const http = await redirector(site.origin, { wrong: true });
  const www = await redirector(site.origin, { wrong: true });
  const free_ = await free({ noindex: false, closedRobots: false });
  try {
    const r = await run([site.origin, "--http", http.origin, "--www", www.origin, "--free", free_.origin, ...quick]);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /Plain http: HTTP 200 — it should be a redirect/);
    assert.match(r.stdout, /www name .*HTTP 200 — it should be a permanent redirect/);
    assert.match(r.stdout, /NOT marked noindex/);
    assert.match(r.stdout, /does not ask crawlers to stay out/);
  } finally {
    for (const s of [site, http, www, free_]) s.close();
  }
});

test("a redirect to the wrong place is not good enough", async () => {
  const site = await standIn();
  const www = await redirector("https://elsewhere.example");
  try {
    const r = await run([site.origin, "--www", www.origin, ...quick]);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /www name/);
  } finally {
    site.close();
    www.close();
  }
});

test("the result is written to the run's summary page, and nothing secret is involved", async () => {
  const site = await standIn({ canonical: "https://wrong.example" });
  const summary = join(mkdtempSync(join(tmpdir(), "mawah-smoke-")), "summary.md");
  writeFileSync(summary, "");
  try {
    const r = await run([site.origin, ...quick], { GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.code, 1);
    const md = readFileSync(summary, "utf8");
    assert.match(md, /### The public address: /);
    assert.match(md, /❌ Home page, Bangla/);
    assert.match(md, /✅ .* answers/);
    assert.match(md, /thing(s)? to fix/);
  } finally {
    site.close();
  }
});
