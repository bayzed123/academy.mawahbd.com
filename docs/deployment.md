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

You need a Cloudflare account with **R2** (file storage) switched on once in the dashboard (*R2 → Overview*; it asks for a payment method but the free allowance is generous).

The site starts on the free Cloudflare address that is written in `worker/wrangler.toml` as `SITE_URL` — `https://academy-mawahbd-com.mawahacademy.workers.dev`. Moving it to `academy.mawahbd.com` is a separate step for later ([section 7](#7-day-to-day-releases-rollbacks-domains)); that domain’s DNS zone must be on the same Cloudflare account.

### 2a. From GitHub (recommended — nothing to run on your computer)

Do the one-time GitHub setup in [section 4](#4-github-actions-tests-and-automatic-deploys) (two repository secrets; it works from a phone). Then merge into `main`, or open *Actions → Deploy → Run workflow*. The Deploy workflow:

1. **checks the Cloudflare access** and says in plain words what is missing (a token permission, R2 switched off, an account ID that belongs to another Cloudflare account);
2. **creates whatever is missing** on your Cloudflare account — the D1 database `mawah-academy-db`, a KV namespace (Wrangler names it `KV`; older versions `<worker name>-KV` — a re-run recognises either and never makes a second one) and the R2 bucket `mawah-academy-media` — and uses their IDs for that run only (nothing is committed; the two placeholders in `wrangler.toml` stay as they are);
3. applies the database migrations (the first run also loads the 26-class catalogue), deploys the Worker, and gives it an `APP_SECRET` (random, never shown) and, if you added the GitHub secret `SETUP_TOKEN`, your setup token;
4. checks `/api/health` and writes the site’s address into the run’s summary page.

Every later deploy is the same run: it finds what already exists and only publishes what changed. The Worker’s `name` in `wrangler.toml` must be the name of the Worker on the account (`academy-mawahbd-com`).

### 2b. From your computer (the same thing by hand)

```bash
npx wrangler login                                      # opens a browser once
npm run setup:cloudflare -- --dry-run --secrets         # shows what it WOULD do
npm run setup:cloudflare -- --secrets                   # add  --domain academy.mawahbd.com  once that domain is ready
```

The script creates (only if missing) the D1 database `mawah-academy-db`, a KV namespace and the R2 bucket `mawah-academy-media`; writes their IDs into `worker/wrangler.toml`; and creates the two secrets `APP_SECRET` (random, never shown) and `SETUP_TOKEN` (random, **shown once** — copy it). With `--domain` it also attaches the custom domain and sets `SITE_URL`. It is safe to run again: nothing existing is changed or deleted. Committing the updated `wrangler.toml` is optional (resource IDs are not secrets); the GitHub deploys work either way.

### 2c. By hand (what the script does)

```bash
cd worker
npx wrangler login
npx wrangler d1 create mawah-academy-db            # copy the database_id into wrangler.toml
npx wrangler kv namespace create KV                # copy the id into wrangler.toml
npx wrangler r2 bucket create mawah-academy-media
# later, for the custom domain: uncomment  routes = [{ pattern = "academy.mawahbd.com", custom_domain = true }]
# in wrangler.toml and set  SITE_URL = "https://academy.mawahbd.com"
openssl rand -base64 48 | npx wrangler secret put APP_SECRET     # a long random string — keep a copy in a password manager
npx wrangler secret put SETUP_TOKEN                              # any long random string (used once, then deleted)
```

### 2d. Switch on the two Cloudflare products

* **Stream (video)** — dashboard → *Stream* → enable. The Worker finds your customer code by itself; you may also put it in `wrangler.toml` as `STREAM_CUSTOMER_CODE` (the part of `customer-<code>.cloudflarestream.com`). Stream bills per minute stored and delivered — see Cloudflare’s pricing.
* **Workers AI (chatbot)** — nothing to enable; the binding is in `wrangler.toml`. A daily free allowance exists; beyond it usage is billed (the chatbot is capped per visitor and per day, see [spec §5](spec.md#5-ai-support-chatbot)). You can switch the chatbot to Gemini or off in *Admin → AI Chatbot*.

### 2e. Create the tables and deploy

```bash
npm run db:migrate:remote      # applies worker/migrations/*.sql to the real database (first run also loads the 26-class catalogue)
npm run deploy                 # builds everything and runs wrangler deploy
```

Open the site address — the public site is live. Continue with [section 5](#5-first-start-your-admin-account).

> From now on you normally never run these by hand: pushing to `main` does it (section 4).

---

## 3. Secrets and settings reference

**Secrets** are set with `npx wrangler secret put NAME` (run inside `worker/`) and live only in Cloudflare — never in git, never in the dashboard screens.

| Secret | Needed | What it is |
|---|---|---|
| `APP_SECRET` | **required** | Long random string. Peppers password hashes, signs the local test gateway, and encrypts a chatbot key saved from the admin. **Do not change it casually** — see *Key rotation* in [security.md](security.md#key-rotation). The Deploy workflow creates it for you (random, never shown) when the Worker has none |
| `SETUP_TOKEN` | first start only | One-time key for creating the first admin. Choose any long random text (12+ characters) and save it as the GitHub repository secret `SETUP_TOKEN`; the Deploy workflow gives it to the Worker. **Remove it afterwards** (section 5); the dashboard reminds you |
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
| `SITE_URL` | `https://academy-mawahbd-com.mawahacademy.workers.dev` | The public address. Used in links, e-mails, payment callbacks and the checks after a deploy — must match where people really open the site. Change it together with `routes` when the custom domain goes live (section 7) |
| `BRAND_CODE` | `MWH` | Invoice prefix: `INV-MWH-YYYYMMDD-0001` |
| `DEFAULT_LANG` | `bn` | Language for visitors with no preference |
| `PAYMENT_MODE` | `live` | `live` or `sandbox` — selects the gateways’ endpoints |
| `MAIL_FROM` | `MAWAH Academy <no-reply@mawahbd.com>` | Sender (the domain must be verified in Resend) |
| `STREAM_CUSTOMER_CODE` | *(empty)* | Optional; found automatically when empty |
| `TURNSTILE_SITE_KEY` | *(empty)* | Optional public key for Turnstile |

A plain *Variable* typed into the Cloudflare dashboard is replaced by this file on every deploy: keep public settings here, and add *Secrets* in the dashboard if you like (secrets are kept).

Business settings (contact numbers, payment options, refund/privacy/terms texts, analytics IDs, chatbot greeting/FAQ) are **not** deployment settings: the owner edits them in *Admin → Settings*.

---

## 4. GitHub Actions: tests and automatic deploys

Three workflows live in `.github/workflows/`:

| Workflow | Runs | Does |
|---|---|---|
| **CI** (`ci.yml`) | every pull request (and on demand); also reused by Deploy, so `main` is checked before every release | typecheck · unit/integration tests · production build · Playwright end-to-end · Lighthouse gate (Core Web Vitals) · secret scan |
| **Deploy** (`deploy.yml`) | every push to `main` (and on demand) | runs CI → checks the Cloudflare access → finds or creates the database, KV and file storage → records the database restore point → applies migrations → `wrangler deploy` → gives the Worker its secrets → health check. **Until the two Cloudflare secrets exist it deploys nothing and says so in a notice** (the run stays green); a manual run fails loudly instead |
| **Lighthouse (live site)** (`lighthouse.yml`) | after each successful deploy and every Monday | measures the live public pages and fails if a budget is broken |

**One-time GitHub setup** (repository → *Settings*; all of it can be done from a phone):

1. **Secrets and variables → Actions → New repository secret**
   * `CLOUDFLARE_API_TOKEN` — Cloudflare → *My Profile → API Tokens → Create Token* → the **“Edit Cloudflare Workers”** template. Then check that these *Account* permissions are on (the template lacks D1 and R2, add them): *Workers Scripts · Edit*, *Workers KV Storage · Edit*, *D1 · Edit*, *Workers R2 Storage · Edit*; set *Account resources* to your account. Paste the token with nothing before or after it. (For the custom domain later also add, for the `mawahbd.com` zone: *Workers Routes · Edit* and *DNS · Edit*.)
   * `CLOUDFLARE_ACCOUNT_ID` — the 32-character ID in the Cloudflare dashboard address (`dash.cloudflare.com/<account id>/…`). It must be the account that owns your Worker: the Deploy workflow refuses to go on when the account’s `workers.dev` address is not the one in `SITE_URL`, so a wrong account can never receive your database and files.
   * `SETUP_TOKEN` *(optional, for the first start)* — any long random text, 12 characters or more; you use it once to create the first admin ([section 5](#5-first-start-your-admin-account)).
   * (optional) a **variable** `SITE_URL` if Lighthouse should measure a different address than the one in `worker/wrangler.toml`.
2. **Environments → New environment → `production`** — optional, but add *Required reviewers* if you want a human to approve each release.
3. **Branches → Add rule for `main`** — *Require a pull request* and *Require status checks to pass*: pick the CI jobs (*Typecheck, unit tests, build* · *End-to-end (Playwright)* · *Core Web Vitals gate (Lighthouse, mobile)* · *No secrets in the repository*).

**Do not also connect the Worker to Git inside Cloudflare** (*Workers & Pages → your Worker → Settings → Builds*, or the “Import a repository” button). GitHub Actions already deploys it. Cloudflare’s own build would start on every push and every pull request, is not set up for this project’s layout (the Worker’s configuration lives in `worker/` and the apps must be built first), fails, and adds a red **Workers Builds** check to every pull request. If it is connected: *Settings → Builds → Disconnect*.

Branch strategy: work on a branch → open a pull request (CI runs, Dependabot keeps dependencies fresh) → merge → it deploys. **Database changes are always a new file** in `worker/migrations/` (`0004_….sql`), never an edit of an applied one; keep migrations additive (new columns/tables) so the *previous* version keeps working while a deploy rolls out.

---

## 5. First start: your admin account

1. Open `<your site address>/admin/` — until the custom domain is live that is `https://academy-mawahbd-com.mawahacademy.workers.dev/admin/`. While no admin exists the page shows **“Create the first admin”** (if it does not, the Worker has no setup token yet: add the GitHub secret `SETUP_TOKEN` and run Deploy again).
2. Enter your name, e-mail, a strong password (a passphrase of 12+ characters) and the **setup token** (the text you saved as the GitHub secret `SETUP_TOKEN`). The form permanently closes the moment the account exists.
3. Remove the token — in Cloudflare: your Worker → *Settings → Variables and Secrets* → `SETUP_TOKEN` → *Delete* (or `npx wrangler secret delete SETUP_TOKEN`) — and delete the GitHub secret too. The dashboard’s *Things to fix* list shows a reminder until the Worker’s copy is gone.
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

**Manual send-money** (works today with no gateway): enter your receiving bKash/Nagad/Rocket numbers in *Admin → Settings → Payments* (the option appears to students only once a number exists). Buyers first give their own number, then see yours with a 20-minute countdown, send money and submit the TrxID and/or a screenshot (screenshots are kept privately in the R2 bucket, so **R2 must be on**); *Support* staff match the SMS or statement and click **Approve payment**. Put your WhatsApp number in *Settings → Contact & announcement* to give students the ready-written message button.

---

## 7. Day-to-day: releases, rollbacks, domains

* **Release**: merge a pull request into `main`. **Rollback the code**: Cloudflare dashboard → *Workers & Pages → academy-mawahbd-com → Deployments → Rollback*, or `npx wrangler rollback` in `worker/`. **Roll back data**: D1 Time Travel (see security.md) — use only for data loss; migrations are forward-only.
* **See what is happening**: `npx wrangler tail` (live logs) and the in-app *Admin → Activity log*.
* **Put the site on your own domain** (or change it): in `worker/wrangler.toml` uncomment/edit the `routes` line and change `SITE_URL` to the same address — GitHub’s file editor works on a phone — and commit; the next deploy attaches the domain (its DNS zone must be on the same Cloudflare account, and the API token needs *Workers Routes · Edit* and *DNS · Edit* for that zone). From a computer you can instead run `npm run setup:cloudflare -- --domain academy.mawahbd.com`. Then update the payment gateway return/IPN URLs and the Resend sending domain.
* **A staging copy** (optional, to rehearse payments or migrations without touching live data): add an `[env.staging]` block to `wrangler.toml` with its own `name`, `vars` (`PAYMENT_MODE = "sandbox"`), and its own D1/KV/R2 IDs, then `npx wrangler deploy --env staging`.
* **Costs to expect**: Workers, D1, KV and R2 have free allowances that cover a small academy; Stream (per minute stored/delivered) and Workers AI (beyond the daily allowance) are the variable costs. Check Cloudflare’s current pricing pages.

---

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Deploy runs but says *“Nothing was deployed”* / *“Deployment is not set up yet”* | Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (section 4) |
| Deploy is red at **Check the Cloudflare access** | Read the ✗ lines in the run’s summary page: they name the missing token permission, say that R2 must be switched on, or that the account ID belongs to another Cloudflare account. Fix the secret or the token, then *Actions → Deploy → Run workflow* |
| Deploy is red at **Find or create the database…** or says R2 is not enabled | Enable R2 in the dashboard (*R2 → Overview*) and give the token *D1 · Edit*, *Workers KV Storage · Edit* and *Workers R2 Storage · Edit*; run Deploy again |
| A red **Workers Builds: academy-mawahbd-com** check on pull requests, or “Failed” entries in the Worker’s *Deployments* list | The Worker is also connected to Git inside Cloudflare, which this project does not use. *Workers & Pages → your Worker → Settings → Builds → Disconnect*. GitHub Actions is the one deployer |
| The `workers.dev` address shows a plain “Hello World” | Cloudflare’s placeholder Worker is still there: no Deploy has succeeded yet. Open *Actions → Deploy* and read the latest run |
| `/admin/` shows a login form but you never created an admin | The setup form appears only while no admin exists and `SETUP_TOKEN` is set; `npx wrangler secret put SETUP_TOKEN` and reload |
| Students can pay but are not enrolled | The gateway could not reach the IPN URL: check the *Orders* list for *Pending*, the gateway panel’s IPN log, and that `SITE_URL` is exactly your public address |
| Dashboard says “E-mail is not connected” | Set `RESEND_API_KEY` and verify the sending domain; mail goes nowhere without it |
| Video lessons say “video is not available” | Stream is not enabled on the account, or the lesson has no video uploaded/processed yet (the curriculum screen shows the processing state) |
| `npm run dev` complains about a port | Another copy is running (ports 8787, 5173, 5174) — stop it, or run `npm run dev -- --worker-only` |
| Playwright cannot find a browser | `npx playwright install chromium` (or set `CHROMIUM_PATH`) |
