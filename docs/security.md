# Security, incident response and recovery

MAWAH Academy sells **content** (class videos and recipe files) and takes **money** (course fees), and its team is small and non-technical. The design therefore leans on three ideas: *the server decides everything* (the browser is never trusted), *secrets never sit in places a person or a log can see them*, and *every important action leaves a trace*.

The controls below are organised by the **NIST Cybersecurity Framework** functions. Each row says what exists *and where in the code*, so an auditor can check it.

- [1. What we protect](#1-what-we-protect)
- [2. Controls by NIST CSF function](#2-controls-by-nist-csf-function)
- [3. Secrets and keys](#3-secrets-and-keys)
- [4. Accounts, sessions and access control](#4-accounts-sessions-and-access-control)
- [5. Web hardening](#5-web-hardening)
- [6. Protecting the paid content](#6-protecting-the-paid-content)
- [7. Payment integrity](#7-payment-integrity)
- [8. Chatbot safety](#8-chatbot-safety)
- [9. Personal data](#9-personal-data)
- [10. Incident response outline](#10-incident-response-outline)
- [Backup and restore](#backup-and-restore)
- [Key rotation](#key-rotation)
- [11. Known limits and what is not covered](#11-known-limits-and-what-is-not-covered)
- [12. Reporting a vulnerability](#12-reporting-a-vulnerability)

---

## 1. What we protect

| Asset | Why it matters | Main threats |
|---|---|---|
| **Class videos and files** | The product being sold: a leak is lost revenue | Guessable links, shared accounts, hot-linking |
| **Money flow** (orders, payments, refunds, invoices) | Direct financial loss | Forged “payment succeeded” callbacks, tampered amounts, double-spending a coupon, a stolen admin session approving payments |
| **Student accounts and data** | Names, e-mail, phone, order history | Credential stuffing, account takeover, data dump |
| **Admin / staff accounts** | Can change prices, approve payments, read data | Phishing, weak passwords, over-privileged accounts |
| **Keys and secrets** | Payment gateway, e-mail and AI credentials | Commit to git, leak in logs or the UI |
| **Availability and reputation** | Launch-day traffic; certificates carry the brand | Abuse of the chatbot/forms, fake certificates |

---

## 2. Controls by NIST CSF function

### Govern
| Control | Where |
|---|---|
| **Least privilege by role** — one permission table, enforced on *every* admin route on the server and mirrored in the UI (the UI hiding a button is a courtesy, never the control) | `shared/src/constants.ts` (`PERMISSIONS`), `worker/src/middleware/auth.ts` (`requirePerm`) |
| Refunds, team management, settings and the chatbot are **Super Admin only**; only Super Admin sees money on shared screens | same table; tests “enforces the permission matrix per role”, “hides revenue figures …” |
| Secrets policy: every third-party key is a Wrangler secret or encrypted at rest, masked in the UI, never logged | §3 |
| Change control: pull-request template, required CI checks, Dependabot, forward-only migrations | `.github/`, `docs/deployment.md` |

### Identify
| Control | Where |
|---|---|
| Asset and data inventory | §1 and §9; schema in `worker/migrations/0001_init.sql` |
| **Health-check strip + “Things to fix”** flag missing keys, e-mail not connected, the one-time setup token still present, bot protection off | `worker/src/routes/api/admin/dashboard.ts` (`runHealthChecks`) |
| Dependency inventory and update alerts | `package-lock.json`, `.github/dependabot.yml` |

### Protect
| Control | Where |
|---|---|
| **Password storage**: PBKDF2-HMAC-SHA256, 100 000 iterations (the Workers runtime maximum), 128-bit random salt per user, plus a **server-side pepper** (HMAC with `APP_SECRET`) so a database leak alone cannot be attacked offline | `worker/src/lib/crypto.ts` |
| **Brute-force defence**: 8 wrong passwords lock an account for 15 minutes; unknown e-mails cost the same time as known ones (no “does this account exist?” oracle); per-IP and per-account rate limits on login/register/reset | `worker/src/services/auth.ts`, `worker/src/middleware/ratelimit.ts` |
| **Sessions**: 256-bit random token in a `__Host-` `HttpOnly` `Secure` cookie; the server stores only the token’s SHA-256 (a KV dump is useless); students `SameSite=Lax` 30-day sliding window, **staff `SameSite=Strict`, 12 h sliding / 24 h absolute**; changing a password or blocking an account invalidates every older session | `worker/src/lib/session.ts` |
| **HTTPS everywhere + HSTS** (2 years, `includeSubDomains`, `preload`) in production; `upgrade-insecure-requests` | `worker/src/middleware/security.ts` |
| **Content-Security-Policy with no `unsafe-inline`**: inline styles are allowed by *hash*, scripts only from `'self'`, `default-src 'none'`; third-party origins (analytics, Turnstile) are added *only if the owner enabled them*; no inline `style=""` attributes anywhere in the apps | `security.ts` (`buildCsp`), tests “security & caching headers” |
| `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, strict `Referrer-Policy`, `Permissions-Policy` (camera, microphone, geolocation off), `Cross-Origin-Opener-Policy` | `security.ts` |
| **CSRF**: every state-changing, cookie-authenticated request must come from the site’s own origin (`Sec-Fetch-Site` / `Origin` guard — gateway callbacks are exempt because they are authenticated by re-verifying with the gateway) *and* cookies are `SameSite` | `worker/src/middleware/csrf.ts` |
| **Input validation** with zod on every route (types, lengths, ranges, enums); SQL is **parameterised only** — column names for sorting/filtering come from fixed whitelists in code, never from the request | `worker/src/lib/schemas.ts`, `crud.ts` |
| **Uploads**: type decided by *magic bytes*, not the file name or `Content-Type`; images only (SVG refused), resources limited to PDF/zip/office/images/plain text; size caps; stored under content-hash names | `worker/src/lib/files.ts` |
| **CSV exports** neutralise spreadsheet formula injection (`=`, `+`, `-`, `@` prefixes) and add a UTF-8 BOM | `worker/src/lib/csv.ts` |
| **Rate limits** (per Cloudflare location): auth 10/min, checkout 15/min, forms 8/min, chatbot 12/min, general API 120/min — plus daily chatbot caps in KV | `wrangler.toml` `[[ratelimits]]`, `worker/src/routes/api/chat.ts` |
| **Paid content only for enrolled students** — signed, short-lived Stream tokens; R2 files served through an authenticated enrolment check | §6 |
| **First admin bootstrap** by one-time `SETUP_TOKEN`; the endpoint locks itself permanently once any staff account exists | `worker/src/routes/api/admin/auth.ts` |
| Optional **Cloudflare Turnstile** on public forms and registration | `worker/src/lib/turnstile.ts` |
| No test gateway in production: `ALLOW_MOCK_PAYMENTS` is ignored when `ENVIRONMENT = "production"` | `worker/src/services/payments/index.ts` |

### Detect
| Control | Where |
|---|---|
| **Activity log**: every admin write (who, what, when, from which IP, what fields changed — *not* the content), every login/failed login, refunds, approvals, certificate re-issues, cron runs. Read-only in the UI (Super Admin / Viewer); CSV export | `worker/src/lib/audit.ts`, Admin → Activity log |
| **Payment event log** (`payment_events`): every gateway callback, whether it verified, the payload | `worker/src/routes/api/payments.ts` |
| Health strip and dashboard alerts; **Lighthouse and security-header tests in CI** catch regressions; gitleaks on every pull request and every release | `.github/workflows/` |
| Live logs with `npx wrangler tail`; each response carries an `X-Request-Id` to match a user report to a log line | `security.ts` |

### Respond
Incident-response outline (§10): contain → assess → eradicate → recover → notify → review. Built-in levers that work in seconds: **block a student** (ends all their sessions), **deactivate a staff member** (ends theirs immediately), **switch a payment channel off** (Admin → Settings → Payments), **switch the chatbot off**, **revoke a certificate**, **rotate a key** (§ Key rotation).

### Recover
Point-in-time database restore with **D1 Time Travel**, scheduled exports, Worker rollbacks, procedures for key rotation and for the other stores (§ Backup and restore).

---

## 3. Secrets and keys

| Secret | Where it lives | Who/what can read it | Shown in the UI? |
|---|---|---|---|
| `APP_SECRET` | Wrangler secret | Only the running Worker | Never |
| `SSLCOMMERZ_*`, `BKASH_*`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `TURNSTILE_SECRET` | Wrangler secrets | Only the running Worker | Never; the dashboard shows only “connected / not connected” |
| AI key saved from *Admin → AI Chatbot* | D1 column `key_enc`, **AES-256-GCM** (key derived from `APP_SECRET` with HKDF, random nonce per value) | Decrypted in memory when calling the provider | **Never returned by any API**; the screen shows only `ends with ••••1234` |
| Session tokens | Browser cookie; KV stores only a SHA-256 | — | — |
| Password-reset tokens | E-mailed link; D1 stores only a SHA-256, single-use, 1 hour | — | — |
| Passwords | D1 as PBKDF2 hashes | Nobody (not even the owner) | Never |

Rules: **never** put a key in a file in the repository, in a pull-request comment, in a screenshot or in a chat. The repository is protected by `.gitignore` (`.dev.vars`, `.env*`), a **secret scanner on every pull request and every release** (`.gitleaks.toml`), test values that are obviously fake, and per-run random passwords in the end-to-end tests. If a real key is ever committed: treat it as compromised — **rotate it at the provider first**, then remove it from the code (history rewriting is not enough).

---

## 4. Accounts, sessions and access control

* **Students** register with e-mail + password. E-mail addresses are case-insensitive and unique. “Forgot password” sends a single-use, one-hour link; using it signs out every device. Changing the password signs out every *other* device.
* **Staff** are created only by a Super Admin (*Admin → Team*) with a one-time temporary password that must be changed at first login. A Super Admin cannot demote or deactivate the last Super Admin, nor lock themselves out. A role change or deactivation ends that person’s sessions immediately.
* **Roles**: Super Admin · Content Manager · Support · Viewer — see the matrix in [spec §4](spec.md#4-admin-dashboard). Give people the lowest role that lets them do their job; *Support* can verify manual payments but cannot refund; *Viewer* is read-only.
* **Admin sessions** are `SameSite=Strict` and last at most 12 hours of inactivity / 24 hours in total.
* Recommended for the owner: a long unique passphrase in a password manager, a separate e-mail account for the admin login, and a second Super Admin so the academy is never locked out.

---

## 5. Web hardening

Everything in the *Protect* table above applies to all three surfaces. A few specifics worth knowing:

* **Three CSP flavours**: public pages (strict, hashed inline CSS), the React apps (same, plus the Stream/upload origins), the JSON API (`default-src 'none'`).
* **Cacheable vs private**: public pages and public API reads are cacheable; everything authenticated is `Cache-Control: no-store`; cached HTML never contains anything user-specific (a non-secret cookie flag toggles “Log in / My Learning” client-side).
* **Open-redirect safe**: login `?next=` accepts only same-site paths.
* **Information hygiene**: error responses use stable short codes, never stack traces or SQL; wrong-password answers are identical for unknown and known accounts; the certificate lookup is rate-limited so codes cannot be brute-forced (60 bits of entropy anyway).

---

## 6. Protecting the paid content

“Course content is the product” — so it is never a guessable URL:

| Content | How it is protected |
|---|---|
| **Video** | Uploaded to Cloudflare Stream with `requireSignedURLs = true`. A raw video id is useless: the Worker mints a **short-lived signed token per request**, only after checking the student’s active enrolment (or that the lesson is a free preview of a *published* class) |
| **Payment screenshots** (manual payments) | Stored in a **private** R2 path (`proofs/`) that the public `/media` route refuses to serve; read only by staff with the *verify payments* permission, never cached by browsers or the edge |
| **Lesson files** (recipe cards, PDFs) | Stored in a **private** R2 path (`resources/`) that the public `/media` route refuses to serve; downloaded only through `/api/student/resources/:id/download`, which checks login + enrolment and streams the file with `Content-Disposition: attachment` |
| **Lesson text** | Returned by the API only to enrolled students (or for previews); the public class page and `/api/courses/:slug` expose **titles only** — a test asserts a lesson’s body never appears there |
| **Public images** | Banners, instructor photos and blog covers live under `banners/ photos/ blog/` with content-hash names, served immutably, image types only (SVG refused), sandboxed CSP |
| **Drip** | Locked lessons are refused by the server with the unlock date, not merely hidden in the UI |
| **Revoking** | A refund, revoked enrolment or blocked student closes access immediately (every request re-checks) |

Honest limit: nobody can stop a determined enrolled student from screen-recording. The controls make leaking *inconvenient, traceable (activity log) and revocable*, not impossible.

---

## 7. Payment integrity

* **Webhook-driven, never redirect-driven**: access is granted only by the gateway’s *server-to-server* callback, which the Worker **re-validates with the gateway** (SSLCommerz validator API; bKash execute/query) — posted fields are never trusted. A payment the gateway flags as risky goes to *Awaiting verification* for a human.
* **Amounts come from the database**: quotes and totals are recomputed server-side from current prices, the coupon and the bundle; the order records the price at purchase time; the validated amount must equal the order total.
* **Atomic and idempotent**: marking an order paid, issuing the invoice number, enrolling, counting the coupon and the audit entry happen in **one D1 batch** guarded by a random claim token. Replayed webhooks, double clicks and two staff approving at once change nothing the second time (tests cover each).
* **Manual payments**: the payer’s own number is recorded before the payment window starts; the TrxID is unique across orders (partial unique index); proof is accepted only from the order’s owner and only while the order is open; approval is a Support/Super Admin action in the audit log. **Payment screenshots are private**: uploaded as a raw body with a size cap, accepted by magic bytes only (JPEG/PNG/WebP/AVIF, no SVG), stored in R2 under `proofs/` with an unguessable hash name, opened only through `GET /api/admin/orders/:id/proof-image` (needs `orders:verify` — Support or Super Admin; a Viewer or Content Manager is refused), served `no-store` with `nosniff` and a sandboxing CSP, and deleted 90 days after the order is settled. The countdown is advisory — the server never refuses proof because of the clock, so a wrong phone clock can neither block nor extend anything.
* **Refunds** are Super Admin only with a mandatory reason; the record and invoice number stay.
* **Test gateway** is compiled out of production behaviour (environment check), and its “webhook” is HMAC-signed like a real one.

---

## 8. Chatbot safety

* It can only **read** (the catalogue, policies and FAQ the owner published). It has **no tools, no database writes, no access to student data** — a prompt injection can at worst make it say something wrong; the system prompt tells it to hand off when unsure.
* Visitor text is never rendered as HTML; replies are treated as text.
* Abuse and cost caps: per-minute rate limit, 80 messages/day/IP, 4,000/day site-wide, bounded input length and history.
* The owner can switch it off (*Admin → Settings → Chatbot* or *AI Chatbot*) without a deploy.

---

## 9. Personal data

What is stored: students’ **name, e-mail, phone, password hash, language, order and learning history**; contact-form messages; newsletter and “notify me” e-mail addresses; staff accounts; IP addresses in the activity log. **No card numbers or wallet PINs ever touch this system** — payment happens on SSLCommerz’s/bKash’s pages.

| Data | Retention today |
|---|---|
| Expired/used password-reset tokens | Deleted by the 6-hourly cron after 7 days |
| Unverified payment events | Deleted after 90 days (verified ones are kept for audit) |
| Abandoned (pending) checkouts | Cancelled after 48 hours (an unpaid manual order too; one waiting for staff is never auto-closed) |
| Payment screenshots (manual payments) | Deleted 90 days after the order was settled (paid, refused, cancelled or refunded) — they can show balances and phone numbers |
| Orders, enrolments, certificates, activity log | Kept (accounting and certificate verification need them) |

Honest limits: there is **no self-service “delete my account”** yet — a student can be *blocked* in the admin, and a data-deletion/anonymisation request has to be handled by a developer with SQL. Add this before you serve people in jurisdictions with strict deletion rights. Write your own privacy policy and terms (*Admin → Settings → Policies*) — the placeholders are not legal advice.

---

## 10. Incident response outline

**Roles** (small team): *Incident lead* (the owner or a delegate who decides), *Operator* (whoever has Super Admin + Cloudflare access), *Communicator* (talks to students).

**First 15 minutes — contain**
1. **Don’t panic, don’t delete evidence.** Note the time and what you saw (screenshot, order number, student e-mail).
2. Suspicious admin activity? *Admin → Team → Deactivate* the account (ends its sessions at once), and have the owner change their own password.
3. Suspicious student activity? *Admin → Students → Block* (ends all their sessions and logins).
4. Money looks wrong? *Admin → Settings → Payments*: switch the affected channel **off**; check *Orders* and the gateway panel.
5. Abuse of the chatbot or forms? Switch the chatbot off; tighten Turnstile (set the keys).
6. A key or secret was exposed? **Rotate it now** at the provider (SSLCommerz, bKash, Resend, Google) and `wrangler secret put` the new one. If `APP_SECRET` itself leaked, follow [Key rotation](#key-rotation).

**Next hours — assess and eradicate**
7. Read *Admin → Activity log* (filter by action/actor) and `npx wrangler tail`; compare with `payment_events` and the gateway’s own reports. Find *what* happened, *since when*, *who/what was affected*.
8. Close the hole (fix the bug, remove the access, update the dependency) — through a pull request so the fix is tested and deployed by CI.
9. Re-check integrity: orders vs gateway statements, enrolments vs orders, certificates. Revoke anything fraudulent (*Certificates → Revoke*, *Students → revoke access*).

**Recover**
10. If data was damaged: restore from **D1 Time Travel** (below) to just before the incident — *after* exporting the current state so nothing newer is lost.
11. Re-enable channels one at a time; watch the activity log.

**Notify**
12. Tell affected students plainly what happened and what you did; if personal data was exposed, tell them what to watch for. Where the law requires it, notify the relevant authority — get local legal advice (this document is not legal advice).

**Review (within a week)**: a short written post-mortem — timeline, root cause, what worked, what to change — and a ticket for each fix. Update this document.

---

## Backup and restore

| Store | What it holds | Backup | Restore |
|---|---|---|---|
| **D1** (everything relational) | Students, orders, enrolments, classes, settings, audit log | **Time Travel** — automatic point-in-time history (7 days on the Free plan, 30 on Paid); the **Deploy** workflow prints the restore bookmark in every run’s summary. Plus manual **exports** | `wrangler d1 time-travel restore DB --timestamp <ISO time>` (or `--bookmark <id>`) |
| **R2** | Instructor photos, banners, blog covers, **private lesson files** | Keep the original files you uploaded (they are your master copy); optionally mirror the bucket with `rclone` | Re-upload from your masters or restore the mirror |
| **Stream** | Class videos | Keep your original video files | Re-upload and re-attach in the curriculum screen |
| **KV** | Sessions, cache version, daily chat counters | Disposable | Nothing to restore — everyone simply logs in again |
| **Secrets** | `APP_SECRET`, gateway keys … | Keep an encrypted copy in a password manager (Cloudflare will not show them again) | `wrangler secret put` |
| **Code** | Everything else | GitHub is the source of truth | `git clone` + deploy |

**Commands** (run in `worker/`, logged in with `npx wrangler login`):

```bash
# see the current restore point and the available history
npx wrangler d1 time-travel info DB

# take a manual export (schema + data) — store it encrypted and private: it contains personal data
npx wrangler d1 export DB --remote --output backup-$(date +%F).sql

# roll the database back to a moment BEFORE the incident (export first!)
npx wrangler d1 time-travel restore DB --timestamp 2026-10-14T09:30:00Z
```

**Routine**: take an export **weekly** and before any risky change; **rehearse a restore once** on a throw-away copy (`wrangler d1 create mawah-restore-test`, `d1 execute … --file backup.sql`) so the first time you need it is not the first time you try it. Do **not** store exports in the git repository or as GitHub Actions artifacts (they contain personal data).

---

## Key rotation

* **Gateway / e-mail / Gemini keys**: create a new key at the provider, `npx wrangler secret put NAME`, then revoke the old key at the provider. Takes effect on the next request.
* **`APP_SECRET`** (password pepper + encryption key). Sessions use random tokens, so **nobody is logged out**. Do it in this order:
  1. `npx wrangler secret put APP_SECRET_PREVIOUS` ← the **old** value
  2. `npx wrangler secret put APP_SECRET` ← the **new** value (≥ 32 random characters)
  3. From now on every successful login **re-hashes that user’s password with the new pepper** automatically. Users who have not logged in yet still work, because the old value is tried second.
  4. *Admin → AI Chatbot*: re-save the Gemini key (it is re-encrypted with the new secret).
  5. After a few months, when active users have logged in (anyone left uses “forgot password”), delete the old value: `npx wrangler secret delete APP_SECRET_PREVIOUS`.
* **If `APP_SECRET` was exposed**: do steps 1–4, then also force password resets for staff, and consider blocking dormant accounts.

---

## 11. Known limits and what is not covered

* No server-side protection against a student sharing their login (limit concurrent sessions is not implemented) — detect via the activity log; revoke the account.
* No two-factor authentication yet for staff or students (roadmap). Until then use strong unique passphrases and keep the number of Super Admins small.
* Google sign-in is not implemented (the database column exists).
* The payment adapters were verified with simulated responses only — follow the [payment go-live checklist](deployment.md#payment-go-live-checklist).
* No penetration test has been done by a third party; the automated suite covers headers, authorisation, validation, rate limits and the money paths, but is not a substitute.
* Cloudflare, SSLCommerz, bKash, Resend and Google are trusted sub-processors; review their terms and security pages.

---

## 12. Reporting a vulnerability

Please e-mail the site owner (the address on the *Contact* page) with the details and steps to reproduce; do not post it publicly or test against other people’s accounts. You will get an acknowledgement and be kept informed. Please allow a reasonable time to fix before disclosing.
