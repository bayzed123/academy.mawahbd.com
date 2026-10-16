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

The site’s public address is **`https://mawahacademy.com`** — `SITE_URL` and the `routes` list in `worker/wrangler.toml`; `www.mawahacademy.com` sends visitors on to it. The domain’s DNS zone is on the same Cloudflare account (the domain was bought there), so the deploy attaches both names to the Worker by itself and Cloudflare creates their DNS records and certificates; a brand-new domain needs a few minutes before it answers, and the deploy waits for it. The free address `https://academy-mawahbd-com.mawahacademy.workers.dev` keeps working as a fallback (and for the checks right after a deploy), but it is marked “noindex” so search engines only list the real address. Changing the domain later is [section 7](#7-day-to-day-releases-rollbacks-domains).

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
npm run setup:cloudflare -- --secrets                   # add  --domain mawahacademy.com --www  to attach the domain from your computer instead
```

The script creates (only if missing) the D1 database `mawah-academy-db`, a KV namespace and the R2 bucket `mawah-academy-media`; writes their IDs into `worker/wrangler.toml`; and creates the two secrets `APP_SECRET` (random, never shown) and `SETUP_TOKEN` (random, **shown once** — copy it). With `--domain` it also attaches the custom domain and sets `SITE_URL`. It is safe to run again: nothing existing is changed or deleted. Committing the updated `wrangler.toml` is optional (resource IDs are not secrets); the GitHub deploys work either way.

### 2c. By hand (what the script does)

```bash
cd worker
npx wrangler login
npx wrangler d1 create mawah-academy-db            # copy the database_id into wrangler.toml
npx wrangler kv namespace create KV                # copy the id into wrangler.toml
npx wrangler r2 bucket create mawah-academy-media
# the custom domain (routes) and SITE_URL are already set in wrangler.toml — change both to move the site (section 7)
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
| `SSLCOMMERZ_STORE_ID` · `SSLCOMMERZ_STORE_PASSWORD` | for bKash/Nagad/Rocket/card payments | The **Store ID** and **Store Password** from your SSLCommerz merchant panel (*Integration → API credentials*; sandbox credentials first). They are **not** your panel log-in: never type the panel’s user name or password anywhere on this website or in a chat. Put them in Cloudflare, or as the GitHub secrets of the same names — the Deploy workflow then sets them on the Worker **on every deploy** (a value that does not look like a Store ID / password is skipped and said so; the value itself is never printed) |
| `SMS_API_KEY` · `SMS_API_URL` | for text messages | The API key from your SMS company’s panel and the company’s address (`https://msg.mram.com.bd`). Same two ways as the e-mail key: the GitHub secrets of those names (copied to the Worker on every deploy), or Cloudflare. Full steps and the one-click check: [section 3b](#3b-text-messages-sms-the-key-the-address-and-the-one-click-check) |
| `BKASH_APP_KEY` · `BKASH_APP_SECRET` · `BKASH_USERNAME` · `BKASH_PASSWORD` | only for *direct* bKash | From bKash’s tokenized-checkout onboarding |
| `RESEND_API_KEY` | strongly recommended | Sends receipts, password resets, launch e-mails and the owner’s notifications ([resend.com](https://resend.com); the key and the verified sending domain must be in the **same** Resend account). Save it as the GitHub repository secret `RESEND_API_KEY` and run Deploy: the workflow sets it on the Worker **every time**, so changing or rotating the key is one edit of that GitHub secret (or add it in Cloudflare if you do not use the GitHub secret). Without it the dashboard warns “e-mail not connected”. Full steps and the one-click check: [section 3a](#3a-e-mail-resend-the-domain-the-key-the-owners-inbox-and-the-one-click-test) |
| `GEMINI_API_KEY` | optional | Only if you want the Gemini chatbot. Alternatively paste the key in *Admin → AI Chatbot* (stored encrypted, shown masked) |
| `TURNSTILE_SECRET` | optional | Cloudflare Turnstile bot protection on public forms (also set the `TURNSTILE_SITE_KEY` variable) |
| `APP_SECRET_PREVIOUS` | only while rotating `APP_SECRET` | The old value |
| `ALLOW_MOCK_PAYMENTS` | **never in production** | Enables the test gateway for local development only; ignored when `ENVIRONMENT = "production"` |

**Variables** (public, in `worker/wrangler.toml → [vars]`):

| Variable | Default | Meaning |
|---|---|---|
| `ENVIRONMENT` | `production` | `production` turns on HSTS, `__Host-` cookies, the edge page cache and disables the test gateway |
| `SITE_URL` | `https://mawahacademy.com` | The public address. Used in links, e-mails, payment callbacks, canonical links, the sitemap and the checks after a deploy — must match where people really open the site and be one of the names in `routes`. Change both together to move the site (section 7) |
| `BRAND_CODE` | `MWH` | Invoice prefix: `INV-MWH-YYYYMMDD-0001` |
| `DEFAULT_LANG` | `bn` | Language for visitors with no preference |
| `PAYMENT_MODE` | `live` | `live` or `sandbox` — selects the gateways’ endpoints |
| `MAIL_FROM` | `MAWAH Academy <no-reply@mawahacademy.com>` | Sender (the domain must be verified in Resend — add the DNS records Resend shows to the `mawahacademy.com` zone in Cloudflare — before any e-mail can be sent) |
| `MAIL_REPLY_TO` | `mawahacademy@gmail.com` | Where a reply goes when a student answers a receipt or any other e-mail from the site (the “Reply-To” header). Gmail itself cannot be the *sender* with Resend — mail “from” a gmail.com address is rejected by the receiving servers — so the site sends as `MAIL_FROM` and replies come to this inbox |
| `NOTIFY_EMAIL` | `mawahacademy@gmail.com` | The owner’s inbox for **every** notification: a paid order, a payment waiting to be checked, a contact-form message, a new student, a question on a class, a review waiting, a chatbot hand-over, a private-group request, a “notify me” sign-up, a newsletter sign-up. More addresses and an off switch for each kind are in *Admin → Settings → E-mail → Notifications to you* |
| `STREAM_CUSTOMER_CODE` | *(empty)* | Optional; found automatically when empty |
| `TURNSTILE_SITE_KEY` | *(empty)* | Optional public key for Turnstile |

A plain *Variable* typed into the Cloudflare dashboard is replaced by this file on every deploy: keep public settings here, and add *Secrets* in the dashboard if you like (secrets are kept).

Business settings (contact numbers, payment options, refund/privacy/terms texts, analytics IDs, chatbot greeting/FAQ) are **not** deployment settings: the owner edits them in *Admin → Settings*.

---

### 3a. E-mail (Resend): the domain, the key, the owner’s inbox, and the one-click test

Receipts, password resets and “the class is open” e-mails go through [Resend](https://resend.com). Every event the owner should know about is e-mailed to **mawahacademy@gmail.com** as well (the variable `NOTIFY_EMAIL`). A message that Resend refuses leaves no trace on the website, so four things must be true — and the admin can check all of them with buttons.

1. **The sending domain is verified in the Resend account that owns the key.** The site sends as `MAIL_FROM` in `worker/wrangler.toml` (`MAWAH Academy <no-reply@mawahacademy.com>`), so `mawahacademy.com` itself must be a *verified* domain in that Resend account. A key from an account that has not verified the domain gets Resend’s answer “the domain is not verified” (HTTP 403) for every message — the usual reason that “the key is set but nothing arrives”.
   - The domain was added to the current Resend account on 2026-10-15 (region *us-east-1*). Its four DNS records are in **[`docs/email-dns-records.txt`](email-dns-records.txt)**: Cloudflare → *Websites* → `mawahacademy.com` → *DNS* → *Records* → *Import and export* → *Import*, choose that file, **keep every row DNS only** (grey cloud). Or add the four rows with *Add record* — the same values are shown at resend.com → *Domains* → `mawahacademy.com`. They live on the names `resend._domainkey`, `send` and `rsend`, so the website itself is not touched.
   - Press *Verify DNS Records* at Resend (usually minutes; the status changes from *Not started* / *Pending* to *Verified*). If the domain is ever removed from Resend and added again, Resend shows a **new** key — copy the rows Resend shows, not the file.
2. **The key is on the website.** Resend → *API Keys* → *Create API Key*, permission **Sending access**, in the same account as the domain. Give it to the website as the secret `RESEND_API_KEY` in either way:
   - the GitHub repository secret `RESEND_API_KEY` (Settings → Secrets and variables → Actions), then run *Deploy*: the workflow sets it on the Worker **on every deploy**, so the GitHub secret is the one place to change it — a new key reaches the Worker with the next Deploy; or
   - the Cloudflare dashboard → Workers & Pages → `academy-mawahbd-com` → Settings → Variables and Secrets, or `npx wrangler secret put RESEND_API_KEY` inside `worker/` (used only while there is no GitHub secret of that name; a valid GitHub secret wins at the next Deploy).

   A key that was pasted into a chat, an e-mail or a ticket is no longer private: create a new one, put it in the GitHub secret, run Deploy, and delete the old one at Resend. Never put a key in a file in the repository.
3. **The owner’s inbox.** Notifications go to `NOTIFY_EMAIL` (`mawahacademy@gmail.com`) with `Reply-To` set to `MAIL_REPLY_TO` (the same address). *Admin → Settings → E-mail → Notifications to you* adds more addresses, switches single kinds off, and has a *Send a test notification* button. Gmail cannot be the sender itself (see `MAIL_REPLY_TO` above): the mail arrives *from* `no-reply@mawahacademy.com`, and pressing *Reply* answers to the Gmail inbox.
   - **Before the domain is verified** the site still reaches the owner: when Resend refuses the domain, the owner’s own notifications are sent again from Resend’s shared test sender `onboarding@resend.dev`. Resend lets that sender deliver only to the e-mail address of the Resend account itself, which is `mawahacademy@gmail.com`; so notifications keep arriving (the test result and the dashboard say “sent with Resend’s test sender”), while e-mails to **students** — receipts, set-your-password links — are refused until step 1 is done. The dashboard’s e-mail card stays amber and names the domain.
4. **It really arrives.** *Admin → Settings → E-mail → Send me a test e-mail* sends one message to **your own** address (never anyone else’s; six an hour) and shows, in plain words and with the steps, what Resend answered: no key / key refused / key may not send, **domain not verified**, bad sender address, sending limit reached, Resend down, or no connection. The dashboard’s e-mail health card turns amber while the last test failed, and the *Connect email* first step stays open until e-mail is fine. The key itself is never shown anywhere — only whether one is set.

### 3b. Text messages (SMS): the key, the address, and the one-click check

Students get their receipt, the link to the class and the link to choose a password by **text message** to the mobile number they gave. A buyer who gave **no e-mail** is reached only this way, so this matters for them. The website talks to the Bangladeshi SMS company (`msg.mram.com.bd`) with two secrets:

1. **`SMS_API_KEY`** — the API key from the company’s panel. **`SMS_API_URL`** — the company’s address, `https://msg.mram.com.bd` (the website works out the sending and the credit addresses from it; an example link from the company’s documentation is accepted too, and only its host is used). Write it with `https://` in front (as a GitHub secret it must; a bare name such as `msg.mram.com.bd` typed in Cloudflare is taken as https). Plain `http://` is always refused: the key travels with every request.
2. Give them to the website the same way as the e-mail key: the GitHub repository secrets `SMS_API_KEY` and `SMS_API_URL` (then run *Deploy* — the workflow sets both on the Worker every time), **or** Cloudflare → Workers & Pages → `academy-mawahbd-com` → *Settings → Variables and Secrets* (used while there is no GitHub secret of that name).
3. **Check it**: *Admin → Settings → SMS*. It shows whether both secrets are set and the host messages go to (never the key), **Check my SMS credit** (the balance the company reports) and **Send test message** (type your own number; six tests an hour). If the company refuses, the screen says why in plain words with the steps: key not accepted · sender name not approved · no credit left · number not accepted · **the company only accepts approved server addresses** · company down. The **Dashboard** has an SMS card that turns amber while the last real message was refused.
4. On the same screen: the **sender name** — the *sender ID* the company approved for you, copied from their panel. **Most companies need one on every message** (without it they answer “required field missing”, which the screen reports as “sender name not accepted”), so fill it in before the first test. Also a switch for all texts, and “also text students who gave an e-mail” (off = only students without an e-mail get texts).

What to know:

- **What the website sends is inferred, not proven.** The company’s documentation lists the credit, price, delivery-report and SMS-sending addresses; the website sends one JSON request (`api_key`, `contacts` as `8801…`, `msg`, `type` = `text` or `unicode`, optional `senderid`) to `…/smsapi`, and if the company answers 404/405/415, a bad request, or “required field missing” (it never read the body), it tries once more as a plain web address with the same details. The “reply means success” rule accepts `response_code` 202, `success`, `status`, or plain words. If the company’s real format differs, **Send test message** shows exactly what it answered (with the key cut out), so it can be fixed in one place (`worker/src/lib/sms.ts`).
- **Masking sender IDs.** A “masking” (brand-name) sender ID can carry **Bangla text only** at many companies; English messages are then refused (the screen says “this sender name only sends Bangla messages”). Use the company’s ordinary (non-masking) sender ID, or ask them which one to use. Students whose language is Bangla get Bangla texts either way.
- **Approved server addresses.** Some SMS companies only accept requests from IP addresses they have approved. This website runs on Cloudflare, whose addresses change, so such a restriction must be switched **off** at the company, otherwise every message is refused with “blocked”.
- **Cost.** An all-English text is one SMS for 160 characters; one with Bangla letters is one SMS for only 70. The English texts say “Tk” instead of ৳ for that reason. A visitor can set off at most three texts per number per hour — a “forgot password” link or a “we got your payment details” note — and 300 a day for the whole site, so nobody can run up the bill (or flood someone’s phone) by typing numbers. Receipts for a real payment, and anything the team sends from the admin, are not counted.
- **Never** type the key into a chat, a file in the repository or a screenshot: anyone who sees it can send messages at your cost. If it was shown anywhere, make a new key at the company, update the GitHub secret and run Deploy.
- In development and in tests (no secrets, not production) texts are kept in a box instead of sent; *Settings → SMS* then says “Test mode”.

## 4. GitHub Actions: tests and automatic deploys

Three workflows live in `.github/workflows/`:

| Workflow | Runs | Does |
|---|---|---|
| **CI** (`ci.yml`) | every pull request (and on demand); also reused by Deploy, so `main` is checked before every release | typecheck · unit/integration tests · production build · Playwright end-to-end · Lighthouse gate (Core Web Vitals) · secret scan |
| **Deploy** (`deploy.yml`) | every push to `main` (and on demand) | runs CI → checks the Cloudflare access → finds or creates the database, KV and file storage → records the database restore point → applies migrations → `wrangler deploy` → gives the Worker its secrets → health check of the free address → waits for the public address and checks it the way a visitor and a search engine meet it (pages, canonical links, `robots.txt`, sitemap, https and www redirects). **Until the two Cloudflare secrets exist it deploys nothing and says so in a notice** (the run stays green); a manual run fails loudly instead |
| **Lighthouse (live site)** (`lighthouse.yml`) | after each successful deploy and every Monday | measures the live public pages and fails if a budget is broken |

**One-time GitHub setup** (repository → *Settings*; all of it can be done from a phone):

1. **Secrets and variables → Actions → New repository secret**
   * `CLOUDFLARE_API_TOKEN` — Cloudflare → *My Profile → API Tokens → Create Token* → the **“Edit Cloudflare Workers”** template. Then check that these *Account* permissions are on (the template lacks D1 and R2, add them): *Workers Scripts · Edit*, *Workers KV Storage · Edit*, *D1 · Edit*, *Workers R2 Storage · Edit*; set *Account resources* to your account. Paste the token with nothing before or after it. **For the custom domain** the token also needs, with *Zone resources* set to include `mawahacademy.com` (*Include → All zones* is the simplest): *Zone → Workers Routes → Edit* and *Zone → Zone → Read*. Optional: *Zone → DNS → Read* lets the check before each deploy warn you about a DNS record that would block the domain. A token made without them can be fixed any time — *My Profile → API Tokens → your token → Edit* — and keeps the same text, so the GitHub secret does not change.
   * `CLOUDFLARE_ACCOUNT_ID` — the 32-character ID in the Cloudflare dashboard address (`dash.cloudflare.com/<account id>/…`). It must be the account that owns your Worker: the Deploy workflow refuses to go on when the account’s `workers.dev` address is not the one in `SITE_URL`, so a wrong account can never receive your database and files.
   * `SETUP_TOKEN` *(optional, for the first start)* — any long random text, 12 characters or more; you use it once to create the first admin ([section 5](#5-first-start-your-admin-account)).
   * (optional) a **variable** `SITE_URL` if Lighthouse should measure a different address than the one in `worker/wrangler.toml`.
2. **Environments → New environment → `production`** — optional, but add *Required reviewers* if you want a human to approve each release.
3. **Branches → Add rule for `main`** — *Require a pull request* and *Require status checks to pass*: pick the CI jobs (*Typecheck, unit tests, build* · *End-to-end (Playwright)* · *Core Web Vitals gate (Lighthouse, mobile)* · *No secrets in the repository*).

**Do not also connect the Worker to Git inside Cloudflare** (*Workers & Pages → your Worker → Settings → Builds*, or the “Import a repository” button). GitHub Actions already deploys it. Cloudflare’s own build would start on every push and every pull request, is not set up for this project’s layout (the Worker’s configuration lives in `worker/` and the apps must be built first), fails, and adds a red **Workers Builds** check to every pull request. If it is connected: *Settings → Builds → Disconnect*.

Branch strategy: work on a branch → open a pull request (CI runs, Dependabot keeps dependencies fresh) → merge → it deploys. **Database changes are always a new file** in `worker/migrations/` (`0004_….sql`), never an edit of an applied one; keep migrations additive (new columns/tables) so the *previous* version keeps working while a deploy rolls out.

---

## 5. First start: your admin account

1. Open `https://mawahacademy.com/admin/` (the free address `https://academy-mawahbd-com.mawahacademy.workers.dev/admin/` opens the same site and works as a fallback). Sign-in cookies belong to one address, so anyone who signed in on the free address signs in again on the new one — the accounts themselves are the same. While no admin exists the page shows **“Create the first admin”** (if it does not, the Worker has no setup token yet: add the GitHub secret `SETUP_TOKEN` and run Deploy again).
2. Enter your name, e-mail, a strong password (a passphrase of 12+ characters) and the **setup token** (the text you saved as the GitHub secret `SETUP_TOKEN`). The form permanently closes the moment the account exists.
3. Remove the token — in Cloudflare: your Worker → *Settings → Variables and Secrets* → `SETUP_TOKEN` → *Delete* (or `npx wrangler secret delete SETUP_TOKEN`) — and delete the GitHub secret too. The dashboard’s *Things to fix* list shows a reminder until the Worker’s copy is gone.
4. Follow **First steps** on the dashboard (contact details, payments, instructor, lessons, refund policy, e-mail, chatbot, team) — see the [owner guide](owner-guide.md).

---

## 6. Go-live checklist

Tick these before announcing the site (the dashboard’s *Health check* and *Things to fix* cover most of them):

- [ ] Contact details (WhatsApp, phone, e-mail) and the refund / privacy / terms texts are written (*Admin → Settings*)
- [ ] **Payments** — work through the [payment checklist](#payment-go-live-checklist) below
- [ ] **E-mail** — `RESEND_API_KEY` set and your sending domain verified ([section 3a](#3a-e-mail-resend-the-domain-the-key-the-owners-inbox-and-the-one-click-test)); press *Admin → Settings → E-mail → Send me a test e-mail* and confirm it arrives
- [ ] **Text messages** — `SMS_API_KEY` and `SMS_API_URL` set ([section 3b](#3b-text-messages-sms-the-key-the-address-and-the-one-click-check)); in *Admin → Settings → SMS* press *Check my SMS credit*, then *Send test message* to your own number and confirm it arrives
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
2. In the SSLCommerz merchant panel set the **IPN URL** to `https://mawahacademy.com/api/payments/sslcommerz/ipn` (the app also sends it with every payment, the panel setting is a safety net). The success/fail/cancel return URLs are sent automatically.
3. As a test student buy a class: **successful** payment → you land on *My Orders* showing *Paid*, the class appears in *My Learning*, an invoice number `INV-MWH-…` exists. Repeat with a **failed** and a **cancelled** payment → the order closes, nothing is granted.
4. Check *Admin → Orders*: one paid order, correct amount, the gateway transaction ID. Try the **refund** flow.
5. Resubmit the same IPN (SSLCommerz’s panel can resend): nothing changes (idempotent). A payment SSLCommerz flags as *risky* lands in **Awaiting verification** for a human to decide.
6. Switch to **live**: put the *live* credentials in the secrets, set `PAYMENT_MODE = "live"` in `wrangler.toml`, deploy, and make one small real purchase with your own wallet/card; refund it from the gateway’s panel and mark the order refunded in the admin.

**Direct bKash** (optional): same idea with `BKASH_*` secrets in sandbox, `PAYMENT_MODE = "sandbox"`, and the callback `https://mawahacademy.com/api/payments/bkash/callback` registered with bKash. Enable *Direct bKash* in *Admin → Settings → Payments*.

**Manual send-money** (works today with no gateway): enter your receiving bKash/Nagad/Rocket numbers in *Admin → Settings → Payments* (the option appears to students only once a number exists). Buyers first give their own number, then see yours with a 20-minute countdown, send money and submit the TrxID and/or a screenshot (screenshots are kept privately in the R2 bucket, so **R2 must be on**); *Support* staff match the SMS or statement and click **Approve payment**. Put your WhatsApp number in *Settings → Contact & announcement* to give students the ready-written message button.

---

## 7. Day-to-day: releases, rollbacks, domains

* **Release**: merge a pull request into `main`. **Rollback the code**: Cloudflare dashboard → *Workers & Pages → academy-mawahbd-com → Deployments → Rollback*, or `npx wrangler rollback` in `worker/`. **Roll back data**: D1 Time Travel (see security.md) — use only for data loss; migrations are forward-only.
* **See what is happening**: `npx wrangler tail` (live logs) and the in-app *Admin → Activity log*.
* **Move the site to another domain** (it lives at `mawahacademy.com` now): the new domain’s DNS zone must be on this Cloudflare account and *Active* (buy it at Cloudflare Registrar, or add the site and switch its name servers). In `worker/wrangler.toml` change the `routes` line (the name and, if you want it, its `www.` twin) and `SITE_URL` to the new name — GitHub’s file editor works on a phone — and merge. The next Deploy first looks at the domain and stops with a plain sentence **before publishing anything** if the zone is missing or inactive, the token may not manage Workers routes for it, another Worker uses the name, or a DNS record is in the way (delete that record in the dashboard: *the domain → DNS → Records*). Otherwise it attaches the names, waits until the address answers and checks the pages, canonical links, `robots.txt`, the sitemap and the https/www redirects; the result is on the run’s summary page. From a computer: `npm run setup:cloudflare -- --domain <name> --www`. Afterwards update the payment gateway return/IPN URLs, the Resend sending domain (`MAIL_FROM`) and any Google Search Console / analytics property; people sign in again on the new address.
* **Prove to another service that the site is yours** (Meta’s domain verification, Google Search Console, Bing, Pinterest … give you a small file to put at the root of the website): put the file, **exactly as the service gave it** (same name, same content), in `marketing/verification/` — on GitHub: *Add file → Upload files* into that folder — and let the *Deploy* run. It then opens at `https://mawahacademy.com/<file name>` (open it in a browser to see its content before pressing *Verify*). The Worker answers it with a plain 200 (`worker/src/routes/seo.ts`; Cloudflare’s asset layer would redirect a `*.html` address first, which some services do not follow). A file in the project’s main folder is **not** on the website. Taken: names of letters, digits, `.` `-` `_` ending in `.html`, `.txt` or `.xml`, up to 4 KB; the build says which file it did not take (`scripts/lib/verification-files.mjs`). A verification by DNS record or `<meta>` tag needs no file.
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
| Deploy is red at **Check the public address** | The release is published and the free address works; the summary page lists what is wrong. A new domain needs minutes for its DNS record and certificate (the check waits ten, then fails) — run Deploy again after a while. Also look at *Workers & Pages → the Worker → Settings → Domains & Routes*: both names should be listed as active. Some networks remember “no such name” for up to 30 minutes if the name was looked up before it existed |
| Deploy is red at **Check the Cloudflare access** with a line about the domain | The line says what to fix: the domain must be listed under *Websites* in this account and *Active*; the token needs *Zone → Workers Routes → Edit* and *Zone → Zone → Read* for it; another Worker or an existing A/AAAA/CNAME record on the name blocks it. Nothing was published; fix it and run Deploy again |
| The new address shows a certificate warning or “can’t reach this site” right after the first deploy | Cloudflare is still issuing the certificate and DNS record for the custom domain — usually a few minutes. If it lasts over 30 minutes, check *Domains & Routes* as above |
| The `workers.dev` address shows a plain “Hello World” | Cloudflare’s placeholder Worker is still there: no Deploy has succeeded yet. Open *Actions → Deploy* and read the latest run |
| `/admin/` shows a login form but you never created an admin | The setup form appears only while no admin exists and `SETUP_TOKEN` is set; `npx wrangler secret put SETUP_TOKEN` and reload |
| Students can pay but are not enrolled | The gateway could not reach the IPN URL: check the *Orders* list for *Pending*, the gateway panel’s IPN log, and that `SITE_URL` is exactly your public address |
| Dashboard says “E-mail is not connected”, or “The last test e-mail did not work” | Open *Admin → Settings → E-mail* and press *Send me a test e-mail*: it says in plain words what Resend answered (key missing or refused, **domain not verified**, bad sender address, limit reached) and what to do — see [section 3a](#3a-e-mail-resend-the-domain-the-key-the-owners-inbox-and-the-one-click-test) |
| The key is set, the test says **domain not verified**, and receipts do not arrive (the owner’s notifications may still come, marked “Resend’s test sender”) | The Resend account behind the key has not verified `mawahacademy.com` yet. Import [`docs/email-dns-records.txt`](email-dns-records.txt) in Cloudflare → DNS → *Import and export* (all rows **DNS only**), then *Verify DNS Records* at resend.com → Domains. Make sure the key was created in that same Resend account |
| Video lessons say “video is not available” | Stream is not enabled on the account, or the lesson has no video uploaded/processed yet (the curriculum screen shows the processing state) |
| `npm run dev` complains about a port | Another copy is running (ports 8787, 5173, 5174) — stop it, or run `npm run dev -- --worker-only` |
| Playwright cannot find a browser | `npx playwright install chromium` (or set `CHROMIUM_PATH`) |
