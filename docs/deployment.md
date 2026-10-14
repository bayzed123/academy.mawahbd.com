# Deployment guide

Two paths: **run it on your computer** (no account needed, takes two minutes) and **put it on Cloudflare** (once, then every push to `main` deploys itself).

- [1. Run it locally](#1-run-it-locally)
- [2. Put it on Cloudflare — first time](#2-put-it-on-cloudflare--first-time)
- [3. Secrets and settings reference](#3-secrets-and-settings-reference)
- [4. GitHub Actions: tests and automatic deploys](#4-github-actions-tests-and-automatic-deploys)
- [5. First start: your admin account](#5-first-start-your-admin-account)
- [6. Go-live checklist](#6-go-live-checklist)
- [Payment go-live checklist](#payment-go-live-checklist)
- [7. Day-to-day: releases, rollbacks, domains](#7-day-to-day-releases-rollbacks-domains)
- [8. Troubleshooting](#8-troubleshooting)

---

## 1. Run it locally

You need **Node.js 20.19 or newer** (22 recommended) and git. Nothing is created on Cloudflare: Wrangler runs a local copy of D1 (database), KV and R2 on your machine.

```bash
git clone https://github.com/bayzed123/academy.mawahbd.com
cd academy.mawahbd.com
npm ci
npm run dev
```

`npm run dev` prepares everything and prints the addresses:

| What | Address |
|---|---|
| Public site (Bangla / English) | http://localhost:8787 · http://localhost:8787/en |
| Student app | http://localhost:8787/app/ (hot-reload copy: http://localhost:5173/app/) |
| Admin | http://localhost:8787/admin/ (hot-reload copy: http://localhost:5174/admin/) |

* The **first admin** is created on the admin address with the setup token from `worker/.dev.vars` (`dev-setup-token`).
* At checkout, choose **“Test payment”** — a simulated gateway that exists only locally.
* The first run loads **demo data** (lessons for *Beginners Baking Class*, a free taster class, the coupon `WELCOME10`, business settings). `npm run dev -- --reset` starts from a clean database, `--seed` reloads the demo data.
* Cloudflare Stream (video) and Workers AI (chatbot) only exist on a real Cloudflare account, so locally video lessons show a friendly notice and the chatbot answers with its hand-off message.

Everything else: `npm run typecheck` · `npm test` · `npm run build && npm run test:e2e` · `npm run lighthouse:local` (see [tests/README.md](../tests/README.md)).

---

## 2. Put it on Cloudflare — first time

You need a Cloudflare account. **R2** (file storage) must be switched on once in the dashboard (*R2 → Overview*; it asks for a payment method but the free allowance is generous). The domain `mawahbd.com` should already be on this Cloudflare account (its DNS zone), so `academy.mawahbd.com` can be attached automatically.

### 2a. Automatic (recommended)

```bash
npx wrangler login                                   # opens a browser once
npm run setup:cloudflare -- --dry-run --domain academy.mawahbd.com --secrets   # shows what it WOULD do
npm run setup:cloudflare -- --domain academy.mawahbd.com --secrets
```

The script creates (only if missing) the D1 database `mawah-academy-db`, the KV namespace `mawah-academy-KV` and the R2 bucket `mawah-academy-media`; writes their IDs into `worker/wrangler.toml`; attaches the custom domain and sets `SITE_URL`; and creates the two secrets `APP_SECRET` (random, never shown) and `SETUP_TOKEN` (random, **shown once** — copy it). It is safe to run again: nothing existing is changed or deleted. Commit the updated `wrangler.toml` (resource IDs are not secrets).

### 2b. By hand (what the script does)

```bash
cd worker
npx wrangler login
npx wrangler d1 create mawah-academy-db            # copy the database_id into wrangler.toml
npx wrangler kv namespace create KV                # copy the id into wrangler.toml
npx wrangler r2 bucket create mawah-academy-media
# in wrangler.toml, uncomment:  routes = [{ pattern = "academy.mawahbd.com", custom_domain = true }]
# and set  SITE_URL = "https://academy.mawahbd.com"
openssl rand -base64 48 | npx wrangler secret put APP_SECRET     # a long random string — keep a copy in a password manager
npx wrangler secret put SETUP_TOKEN                              # any long random string (used once, then deleted)
```

### 2c. Switch on the two Cloudflare products

* **Stream (video)** — dashboard → *Stream* → enable. The Worker finds your customer code by itself; you may also put it in `wrangler.toml` as `STREAM_CUSTOMER_CODE` (the part of `customer-<code>.cloudflarestream.com`). Stream bills per minute stored and delivered — see Cloudflare’s pricing.
* **Workers AI (chatbot)** — nothing to enable; the binding is in `wrangler.toml`. A daily free allowance exists; beyond it usage is billed (the chatbot is capped per visitor and per day, see [spec §5](spec.md#5-ai-support-chatbot)). You can switch the chatbot to Gemini or off in *Admin → AI Chatbot*.

### 2d. Create the tables and deploy

```bash
npm run db:migrate:remote      # applies worker/migrations/*.sql to the real database (first run also loads the 26-class catalogue)
npm run deploy                 # builds everything and runs wrangler deploy
```

Open `https://academy.mawahbd.com` — the public site is live. Continue with [section 5](#5-first-start-your-admin-account).

> From now on you normally never run these by hand: pushing to `main` does it (section 4).

---

## 3. Secrets and settings reference

**Secrets** are set with `npx wrangler secret put NAME` (run inside `worker/`) and live only in Cloudflare — never in git, never in the dashboard screens.

| Secret | Needed | What it is |
|---|---|---|
| `APP_SECRET` | **required** | Long random string. Peppers password hashes, signs the local test gateway, and encrypts a chatbot key saved from the admin. **Do not change it casually** — see *Key rotation* in [security.md](security.md#key-rotation) |
| `SETUP_TOKEN` | first start only | One-time key for creating the first admin. **Delete it afterwards** (`npx wrangler secret delete SETUP_TOKEN`); the dashboard reminds you |
| `SSLCOMMERZ_STORE_ID` · `SSLCOMMERZ_STORE_PASSWORD` | for bKash/Nagad/Rocket/card payments | From your SSLCommerz merchant account (sandbox credentials first) |
| `BKASH_APP_KEY` · `BKASH_APP_SECRET` · `BKASH_USERNAME` · `BKASH_PASSWORD` | only for *direct* bKash | From bKash’s tokenized-checkout onboarding |
| `RESEND_API_KEY` | strongly recommended | Sends receipts, password resets and launch e-mails ([resend.com](https://resend.com); verify your sending domain). Without it the dashboard warns “e-mail not connected” |
| `GEMINI_API_KEY` | optional | Only if you want the Gemini chatbot. Alternatively paste the key in *Admin → AI Chatbot* (stored encrypted, shown masked) |
| `TURNSTILE_SECRET` | optional | Cloudflare Turnstile bot protection on public forms (also set the `TURNSTILE_SITE_KEY` variable) |
| `APP_SECRET_PREVIOUS` | only while rotating `APP_SECRET` | The old value |
| `ALLOW_MOCK_PAYMENTS` | **never in production** | Enables the test gateway for local development only; ignored when `ENVIRONMENT = "production"` |

**Variables** (public, in `worker/wrangler.toml → [vars]`):

| Variable | Default | Meaning |
|---|---|---|
| `ENVIRONMENT` | `production` | `production` turns on HSTS, `__Host-` cookies, the edge page cache and disables the test gateway |
| `SITE_URL` | `https://academy.mawahbd.com` | Used in links, e-mails and payment callbacks — must match the real address |
| `BRAND_CODE` | `MWH` | Invoice prefix: `INV-MWH-YYYYMMDD-0001` |
| `DEFAULT_LANG` | `bn` | Language for visitors with no preference |
| `PAYMENT_MODE` | `live` | `live` or `sandbox` — selects the gateways’ endpoints |
| `MAIL_FROM` | `MAWAH Academy <no-reply@mawahbd.com>` | Sender (the domain must be verified in Resend) |
| `STREAM_CUSTOMER_CODE` | *(empty)* | Optional; found automatically when empty |
| `TURNSTILE_SITE_KEY` | *(empty)* | Optional public key for Turnstile |

Business settings (contact numbers, payment options, refund/privacy/terms texts, analytics IDs, chatbot greeting/FAQ) are **not** deployment settings: the owner edits them in *Admin → Settings*.

---

## 4. GitHub Actions: tests and automatic deploys

Three workflows live in `.github/workflows/`:

| Workflow | Runs | Does |
|---|---|---|
| **CI** (`ci.yml`) | every pull request and every branch except `main`; also reused by Deploy | typecheck · unit/integration tests · production build · Playwright end-to-end · Lighthouse gate (Core Web Vitals) · secret scan |
| **Deploy** (`deploy.yml`) | every push to `main` (and on demand) | runs CI → records the database restore point → applies migrations → `wrangler deploy` → health check |
| **Lighthouse (live site)** (`lighthouse.yml`) | after each successful deploy and every Monday | measures the live public pages and fails if a budget is broken |

**One-time GitHub setup** (repository → *Settings*):

1. **Secrets and variables → Actions → New repository secret**
   * `CLOUDFLARE_API_TOKEN` — create at Cloudflare → *My Profile → API Tokens → Create Token* from the **“Edit Cloudflare Workers”** template, then add *Account · D1 · Edit* and *Account · Workers R2 Storage · Edit*, limited to your account (and the `mawahbd.com` zone).
   * `CLOUDFLARE_ACCOUNT_ID` — the 32-character account ID shown on the Cloudflare dashboard’s right-hand side.
   * (optional) a **variable** `SITE_URL` if the address differs from `https://academy.mawahbd.com` (used by the health check and Lighthouse).
2. **Environments → New environment → `production`** — optional, but add *Required reviewers* if you want a human to approve each release.
3. **Branches → Add rule for `main`** — *Require a pull request* and *Require status checks to pass*: pick the CI jobs (*Typecheck, unit tests, build* · *End-to-end (Playwright)* · *Core Web Vitals gate (Lighthouse, mobile)* · *No secrets in the repository*).

Branch strategy: work on a branch → open a pull request (CI runs, Dependabot keeps dependencies fresh) → merge → it deploys. **Database changes are always a new file** in `worker/migrations/` (`0004_….sql`), never an edit of an applied one; keep migrations additive (new columns/tables) so the *previous* version keeps working while a deploy rolls out.

---

## 5. First start: your admin account

1. Open `https://academy.mawahbd.com/admin/`. While no admin exists the page shows **“Create the first admin”**.
2. Enter your name, e-mail, a strong password (a passphrase of 12+ characters) and the **setup token**. The form permanently closes the moment the account exists.
3. Delete the token: `npx wrangler secret delete SETUP_TOKEN` (the dashboard’s *Things to fix* list shows a reminder until you do).
4. Follow **First steps** on the dashboard (contact details, payments, instructor, lessons, refund policy, e-mail, chatbot, team) — see the [owner guide](owner-guide.md).

---

## 6. Go-live checklist

Tick these before announcing the site (the dashboard’s *Health check* and *Things to fix* cover most of them):

- [ ] Contact details (WhatsApp, phone, e-mail) and the refund / privacy / terms texts are written (*Admin → Settings*)
- [ ] **Payments** — work through the [payment checklist](#payment-go-live-checklist) below
- [ ] **E-mail** — `RESEND_API_KEY` set and your sending domain verified; request a password reset and confirm it arrives
- [ ] Each class you sell has lessons (the dashboard lists empty ones); at least one video uploaded to Stream plays for a test student
- [ ] *Admin → AI Chatbot → Test connection* shows success; ask it a price question and a question it cannot know (it should hand off)
- [ ] `SETUP_TOKEN` deleted; every team member has their own account with the lowest role that works (*Content Manager* for editors, *Support* for payment checking, *Viewer* for read-only)
- [ ] Optional: Turnstile keys, GA4 / Clarity / Meta Pixel IDs
- [ ] The **Lighthouse (live site)** workflow is green
- [ ] You know how to roll back and restore ([security.md → Backup and restore](security.md#backup-and-restore)); note the Time Travel bookmark shown in each Deploy run summary
- [ ] A real test purchase on your own account has been made, paid, refunded and the invoice looked at

### Payment go-live checklist

The payment adapters were written against the gateways’ public documentation and are covered by automated tests with **simulated** gateway responses. Nobody could try them against the real services while building, so this checklist is the “first contact” — do it in **sandbox mode first**.

**SSLCommerz (bKash · Nagad · Rocket · cards)**

1. Create an SSLCommerz **sandbox** account; put the sandbox *Store ID* and *Store password* in the secrets `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD`, and deploy with `PAYMENT_MODE = "sandbox"`.
2. In the SSLCommerz merchant panel set the **IPN URL** to `https://academy.mawahbd.com/api/payments/sslcommerz/ipn` (the app also sends it with every payment, the panel setting is a safety net). The success/fail/cancel return URLs are sent automatically.
3. As a test student buy a class: **successful** payment → you land on *My Orders* showing *Paid*, the class appears in *My Learning*, an invoice number `INV-MWH-…` exists. Repeat with a **failed** and a **cancelled** payment → the order closes, nothing is granted.
4. Check *Admin → Orders*: one paid order, correct amount, the gateway transaction ID. Try the **refund** flow.
5. Resubmit the same IPN (SSLCommerz’s panel can resend): nothing changes (idempotent). A payment SSLCommerz flags as *risky* lands in **Awaiting verification** for a human to decide.
6. Switch to **live**: put the *live* credentials in the secrets, set `PAYMENT_MODE = "live"` in `wrangler.toml`, deploy, and make one small real purchase with your own wallet/card; refund it from the gateway’s panel and mark the order refunded in the admin.

**Direct bKash** (optional): same idea with `BKASH_*` secrets in sandbox, `PAYMENT_MODE = "sandbox"`, and the callback `https://academy.mawahbd.com/api/payments/bkash/callback` registered with bKash. Enable *Direct bKash* in *Admin → Settings → Payments*.

**Manual send-money** (works today with no gateway): enter your receiving bKash/Nagad/Rocket numbers in *Admin → Settings → Payments* (the option appears to students only once a number exists). Buyers send money and submit the TrxID; *Support* staff verify the SMS and click **Approve payment**.

---

## 7. Day-to-day: releases, rollbacks, domains

* **Release**: merge a pull request into `main`. **Rollback the code**: Cloudflare dashboard → *Workers & Pages → mawah-academy → Deployments → Rollback*, or `npx wrangler rollback` in `worker/`. **Roll back data**: D1 Time Travel (see security.md) — use only for data loss; migrations are forward-only.
* **See what is happening**: `npx wrangler tail` (live logs) and the in-app *Admin → Activity log*.
* **Change the domain**: edit the `routes` line and `SITE_URL` in `wrangler.toml` (or rerun `npm run setup:cloudflare -- --domain new.example.com`), deploy. Update the payment gateway return/IPN URLs and the Resend sending domain.
* **A staging copy** (optional, to rehearse payments or migrations without touching live data): add an `[env.staging]` block to `wrangler.toml` with its own `name`, `vars` (`PAYMENT_MODE = "sandbox"`), and its own D1/KV/R2 IDs, then `npx wrangler deploy --env staging`.
* **Costs to expect**: Workers, D1, KV and R2 have free allowances that cover a small academy; Stream (per minute stored/delivered) and Workers AI (beyond the daily allowance) are the variable costs. Check Cloudflare’s current pricing pages.

---

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Deploy fails: *“worker/wrangler.toml still contains placeholder IDs”* | Run `npm run setup:cloudflare` (or fill in `REPLACE_WITH_D1_ID` / `REPLACE_WITH_KV_ID` by hand) and commit |
| Deploy fails: *“Add the repository secrets …”* | Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (section 4) |
| `setup:cloudflare` says R2 is not enabled | Enable R2 in the dashboard (*R2 → Overview*), run it again |
| `/admin/` shows a login form but you never created an admin | The setup form appears only while no admin exists and `SETUP_TOKEN` is set; `npx wrangler secret put SETUP_TOKEN` and reload |
| Students can pay but are not enrolled | The gateway could not reach the IPN URL: check the *Orders* list for *Pending*, the gateway panel’s IPN log, and that `SITE_URL` is exactly your public address |
| Dashboard says “E-mail is not connected” | Set `RESEND_API_KEY` and verify the sending domain; mail goes nowhere without it |
| Video lessons say “video is not available” | Stream is not enabled on the account, or the lesson has no video uploaded/processed yet (the curriculum screen shows the processing state) |
| `npm run dev` complains about a port | Another copy is running (ports 8787, 5173, 5174) — stop it, or run `npm run dev -- --worker-only` |
| Playwright cannot find a browser | `npx playwright install chromium` (or set `CHROMIUM_PATH`) |
