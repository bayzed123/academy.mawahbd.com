# Decisions to confirm

The brief asks to **confirm two decisions with the requester before finalizing**. They could not be asked mid-build, so each was settled with a sensible default and built so that changing it later is cheap. **Please read this page and tell us if you want either changed.**

## 1. One brand with admin-added instructors (default) — or a multi-instructor marketplace?

**What was built:** MAWAH Academy is a **single-brand** academy. There is one catalogue and one set of payments. A class points to an **instructor profile** (name, bio, photo, credentials, links) that the *owner/team* adds in **Admin → Instructors** — a class page and a `/instructors/:slug` page show it. Teachers do **not** have their own logins, dashboards or payouts.

**Why:** it matches how MAWAH Academy actually sells today (one brand’s classes with one price list), and it keeps the owner’s workload and the security surface small.

**If you later want other teachers to sell their own classes** (a marketplace — roadmap *Phase 4*), these things must be added, in roughly this order: an *instructor* login role with its own limited admin, ownership on classes (`courses.instructor_id` already exists), revenue split and payout records, a review/approval step before a teacher’s class goes live, tax/payout details, and terms for third-party content. The data model already separates `instructors` from `staff`, so this extends rather than rewrites.

> **Decision needed:** keep single-brand? ☐ yes ☐ no, plan the marketplace

## 2. Local payments at launch (default) — or international cards from day one?

**What was built:** **SSLCommerz** (bKash · Nagad · Rocket · cards on one hosted page), optional **direct bKash**, and **manual send-money** with staff verification. All prices are **BDT** whole-taka. **Stripe (international cards) is not built** — it is roadmap *Phase 3*.

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
| **Manual send-money** | Available, but **hidden from students until you enter your receiving numbers** | Yes |
| **Instructor** | A placeholder profile “MAWAH Academy Team” you replace with real people/photos | Yes — Admin → Instructors |
| **Certificates** | One elegant template (“classic”); code `MWH-XXXX-XXXX-XXXX` + QR; printable (Save as PDF) | Templates can be added |
| **Invoices** | `INV-MWH-YYYYMMDD-####`, day = Bangladesh time, gapless; **PDF via the browser’s “Print / Save as PDF”** (so Bangla letters shape correctly) | A server-made PDF is a roadmap item |
| **Chatbot** | Cloudflare Workers AI by default; Gemini switchable in the admin; capped per visitor/day | Yes |
| **Sign-in** | E-mail + password only (Google sign-in is not built; the database column is reserved) | Roadmap |
| **Policies** | Empty placeholders — **you must write** refund, privacy and terms | Admin → Settings → Policies |
| **Logo** | A designed concept (arched doorway + gold “M”) used as the favicon, app icon and share image. If you have an official logo, send it and it replaces the concept | Yes |
| **Analytics** | Nothing is tracked until you paste GA4 / Clarity / Meta Pixel IDs in Admin → Settings → Analytics | Yes |

## 4. What we need from you to go live

1. The **Cloudflare account** (and that `mawahbd.com` is on it) — or a developer you trust to run [the setup](deployment.md).
2. **SSLCommerz** merchant account (sandbox first, then live), and/or your **bKash/Nagad/Rocket numbers** for manual payments.
3. An **e-mail sending domain** at Resend (so receipts and password resets arrive).
4. Real **instructor details and photo**, the **refund / privacy / terms** texts, contact numbers and social links.
5. **Lessons**: videos, notes, recipe cards for each class (start with *Beginners Baking Class*).
6. Your decision on the two questions above.
