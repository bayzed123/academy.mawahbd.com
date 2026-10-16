# Decisions to confirm

The brief asks to **confirm two decisions with the requester before finalizing**. They could not be asked mid-build, so each was settled with a sensible default and built so that changing it later is cheap. **Please read this page and tell us if you want either changed.**

## 1. One brand with admin-added instructors (default) — or a multi-instructor marketplace?

**What was built:** MAWAH Academy is a **single-brand** academy. There is one catalogue and one set of payments. A class points to an **instructor profile** (name, bio, photo, credentials, links) that the *owner/team* adds in **Admin → Instructors** — a class page and a `/instructors/:slug` page show it. Teachers do **not** have their own logins, dashboards or payouts.

**Why:** it matches how MAWAH Academy actually sells today (one brand’s classes with one price list), and it keeps the owner’s workload and the security surface small.

**If you later want other teachers to sell their own classes** (a marketplace — roadmap *Phase 4*), these things must be added, in roughly this order: an *instructor* login role with its own limited admin, ownership on classes (`courses.instructor_id` already exists), revenue split and payout records, a review/approval step before a teacher’s class goes live, tax/payout details, and terms for third-party content. The data model already separates `instructors` from `staff`, so this extends rather than rewrites.

> **Decision needed:** keep single-brand? ☐ yes ☐ no, plan the marketplace

## 2. Local payments at launch (default) — or international cards from day one?

**What was built:** **SSLCommerz** (bKash · Nagad · Rocket · cards on one hosted page), optional **direct bKash**, and **manual send-money** (the student says which number they pay from, has 20 minutes, then sends a TrxID and/or a screenshot, with an optional WhatsApp message; staff verify and approve in the admin). All prices are **BDT** whole-taka. **Stripe (international cards) is not built** — it is roadmap *Phase 3*.

**Why:** the audience is Bangladesh-first; a second gateway, multi-currency prices, tax/VAT presentation and foreign-card dispute handling add real complexity and cost that is only worthwhile once learners abroad actually show up (the site’s analytics and the “notify me” list will tell you).

**If you want international payment at launch:** open a Stripe account, decide the pricing currency (USD price per class, or converted at a fixed rate), and ask us to add Stripe Checkout as a fourth channel — the checkout, webhook, order and invoice flows are already built around “channels”, so it is one adapter plus an admin toggle and a currency field. Invoices would then need to show the currency.

> **Decision needed:** local payments only for launch? ☐ yes ☐ no, add Stripe first

## 3. Other defaults you may want to change

| Topic | What we chose | Easy to change? |
|---|---|---|
| **Word for “course”** | **ক্লাস / Class** everywhere (your own listings say ক্লাস) | Yes — one dictionary file |
| **Language** | Bangla at `/`, English at `/en`; the visitor’s choice is remembered | Yes |
| **Launch status of the 26 classes** | All **Published** (as in your Facebook list) but **with no lessons yet**; the dashboard flags each one. You may prefer to mark classes **Coming Soon** until their lessons exist | Yes — per class in Admin → Classes |
| **Entry classes** | Unchanged prices from your list (৳350 … ৳3,550). The cheapest are good “first purchase” offers | Yes |
| **Manual send-money** | Available with no gateway at all, but **hidden from students until you enter your receiving numbers**. Window **20 minutes** (5–120 in Settings → Payments); late proof is still accepted; proof = TrxID and/or screenshot; screenshots private and deleted after 90 days | Yes |
| **Instructor** | A placeholder profile “MAWAH Academy Team” you replace with real people/photos | Yes — Admin → Instructors |
| **Certificates** | One elegant template (“classic”); code `MWH-XXXX-XXXX-XXXX` + QR; printable (Save as PDF) | Templates can be added |
| **Invoices** | `INV-MWH-YYYYMMDD-####`, day = Bangladesh time, gapless; **PDF via the browser’s “Print / Save as PDF”** (so Bangla letters shape correctly) | A server-made PDF is a roadmap item |
| **Chatbot** | Cloudflare Workers AI by default; Gemini switchable in the admin; capped per visitor/day | Yes |
| **Sign-in** | E-mail + password only (Google sign-in is not built; the database column is reserved) | Roadmap |
| **Buying** | **No account needed**: a visitor gives a name, a mobile number and an e-mail, pays, and the student profile (with its own ID, `STU-000123`) is made for them and they are signed in; the receipt carries a link to choose a password for other phones. Someone who only started to buy is not counted as a student and is removed after 30 days; their details stay in Orders for follow-up. The e-mail of an existing student is never opened by typing it | Built in — nothing to switch on (Cloudflare Turnstile adds a bot check) |
| **Policies** | Empty placeholders — **you must write** refund, privacy and terms | Admin → Settings → Policies |
| **Logo and colours** | Your **official logo** (`brand/mawah-logo.jpg`) is used in the header, footer, sign-in screens, certificates, invoices, app icons and the share image. The colours — **black, red, gold, ivory** — are measured from it; green appears only in tiny “paid / working / genuine” status markers | Yes — replace `brand/mawah-logo.jpg`, run `npm run brand:assets` |
| **Web address** | **`https://mawahacademy.com`**; `www.` sends visitors on to it; the free `workers.dev` address stays as a fallback and is hidden from search engines. The Worker keeps its internal name `academy-mawahbd-com` (renaming it would create a second, empty Worker) | Yes — two lines in `wrangler.toml` ([deployment.md §7](deployment.md)) |
| **Sender of e-mails** | `no-reply@mawahacademy.com` — e-mail works once that domain is verified at Resend | Yes — `MAIL_FROM` in `wrangler.toml` |
| **Replies and the owner’s copies** | Replies go to `mawahacademy@gmail.com` (`Reply-To`), and every event on the site (a payment, a message, a new student, a question, a review, a chatbot hand-off, a private-group request, a sign-up) is e-mailed there too. Gmail itself cannot be the *sender* with Resend — mail “from” a gmail.com address is rejected by receiving servers — so the sender stays on the shop’s own domain. Until the domain is verified, the owner’s notes still arrive through Resend’s test sender | Yes — `MAIL_REPLY_TO` and `NOTIFY_EMAIL` in `wrangler.toml`; addresses and switches in Admin → Settings → E-mail |
| **Analytics** | Your Google Analytics 4 ID `G-J0R62NQJD4` is already in Admin → Settings → Analytics, so the **real site counts** what visitors look at and choose (43 actions, nothing personal). Visitors in **Europe and the UK are asked first**; **Do Not Track**, **Global Privacy Control** and a footer link “Stop counting my visits” are honoured; **no advertising features**; test browsers, the free fallback address and the admin are never counted. **Admin → Analytics** shows the numbers back once you add the Google key (steps in [analytics.md](analytics.md)). Clarity and Meta Pixel stay off until you paste an ID. You should mention Google Analytics in your privacy policy | Yes — clear the ID to stop counting; ask a developer to relax or tighten who is asked first |

## 4. What we need from you to go live

1. The **Cloudflare account** (the domain `mawahacademy.com` is already on it) — or a developer you trust to run [the setup](deployment.md).
2. **SSLCommerz** merchant account (sandbox first, then live), and/or your **bKash/Nagad/Rocket numbers** for manual payments.
3. An **e-mail sending domain** at Resend (so receipts and password resets arrive).
4. Real **instructor details and photo**, the **refund / privacy / terms** texts, contact numbers and social links.
5. **Lessons**: videos, notes, recipe cards for each class (start with *Beginners Baking Class*).
6. Your decision on the two questions above.
