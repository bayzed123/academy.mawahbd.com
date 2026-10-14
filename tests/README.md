# Tests

| Kind | Where | Run | What it proves |
|---|---|---|---|
| Unit + integration (inside the real Workers runtime, local D1/KV/R2) | `worker/test/*.test.ts` | `npm test` | Every route, rule and money calculation: auth, RBAC, checkout, webhooks, enrolment, certificates, admin, chatbot, cron |
| API contract | `tests/fixtures/*.json` + `worker/test/contract.test.ts` | `npm test` | The exact JSON shape of the key endpoints (class list, create order, admin login, certificate verification) and that secrets never leak |
| Route guards + production mode | `worker/test/hardening.test.ts` | `npm test` | Enumerates every registered API route and checks its login/permission guard (a new unguarded endpoint fails here); flips `ENVIRONMENT=production` to check HSTS, `__Host-` cookies, no test gateway, and the edge page cache with its invalidation |
| Script tests | `scripts/lib/*.test.mjs` | `npm run test:scripts` | The helper that fills Cloudflare IDs into `wrangler.toml`; the brand — palette contrast ratios (AA), every CSS variable defined (no leftover green), the logo/icon files the pages point at; React effect callbacks have block bodies (a newer Chrome returns a Promise from `window.scrollTo()`, and an effect that returns it blanks the whole app) |
| End-to-end (real browser, real Worker, fresh seeded database) | `e2e/*.spec.ts` | `npm run build && npm run test:e2e` | Enrol → pay → learn → complete → certificate, the admin workflows, accessibility (axe) and 360 px phones |
| Core Web Vitals gate | `scripts/lighthouse-local.mjs` | `npm run build && npm run lighthouse:local` | Lighthouse (mobile profile) budgets on the public pages |
| Types | all workspaces | `npm run typecheck` | `tsc` must be clean before anything is deployed |

## API fixtures

Each file in `tests/fixtures/` is one API call and the **shape** of its answer:

```jsonc
{
  "name": "Class list",
  "setup": "anonymous",                       // anonymous | student | staff-account | certificate
  "request": { "method": "GET", "path": "/api/courses?per_page=2&sort=price_asc" },
  "response": {
    "status": 200,
    "headers": { "cache-control": "max-age" },  // header must contain this text
    "forbidKeys": ["password_hash"],            // must not appear anywhere in the body
    "shape": { "ok": "boolean", "courses": { "$array": { "id": "number", "slug": "string" }, "$min": 1 } }
  }
}
```

Types are `string | number | boolean | null | object | array | any` (join with `|`, add `?` for "may be absent"). Extra keys are fine, so the API can grow without breaking the tests; a renamed or retyped field fails with its exact path.

## Rules for test data

* Never put a real API key, payment credential or customer data in a test. Fake values look fake (`fake-…-not-a-secret`) and the secret scanner (`.gitleaks.toml`) runs in CI.
* The end-to-end suite starts its own isolated server (`scripts/e2e-server.mjs`, port 8788, state in `.wrangler/e2e`) — it never touches your Cloudflare account or your local dev database.
