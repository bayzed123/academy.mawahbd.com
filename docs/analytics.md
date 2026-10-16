# Analytics — counting visits and actions (Google Analytics 4)

The website counts what visitors look at and choose, and the **Admin → Analytics** screen shows the numbers back to the owner next to the shop’s own sales — *how people see each class*, where they come from, where they stop on the way to paying.

| | |
|---|---|
| Measurement ID | `G-J0R62NQJD4` (put in *Admin → Settings → Analytics* by migration `0013`; the owner can change or clear it there) |
| Property · data stream | `559265538` · `16139065386` (`GA_PROPERTY_ID`, `GA_STREAM_ID` in `worker/wrangler.toml`) |
| Tag | `marketing/analytics.js` (public site and student app) — never in the admin |
| Report | `worker/src/services/analytics.ts` → *Admin → Analytics* (reads Google with a service account) |
| Events | 43, listed [below](#every-event) and in `shared/src/analytics.ts` |

> **বাংলায় সংক্ষেপে —** ওয়েবসাইট ও স্টুডেন্ট অ্যাপ এখন Google Analytics 4-এ ভিজিট ও কাজ (ক্লাস দেখা, “এনরোল” চাপা, চেকআউট, পেমেন্ট, লেসন শেখা…) গোনে; কারও নাম, ইমেইল, ফোন বা ঠিকানা কখনো পাঠানো হয় না। **অ্যাডমিন → অ্যানালিটিক্স** পাতায় প্রতিটি ক্লাস মানুষ কীভাবে দেখছে তা দেখা যায় — তার জন্য একবার Google-এর একটি সার্ভিস অ্যাকাউন্ট বানিয়ে তার JSON ফাইলটি GitHub-এ সিক্রেট `GA4_SERVICE_ACCOUNT_JSON` নামে রাখতে হয় (ধাপগুলো [নিচে](#connecting-the-admin-screen-once-about-ten-minutes) এবং [মালিকের গাইডের ২৫ নম্বরে](owner-guide.md)). **JSON ফাইলটি কখনো চ্যাটে বা স্ক্রিনশটে দেবেন না।**

## 1. How it works

```
 visitor's browser                         Cloudflare Worker                              Google
 ─────────────────                         ─────────────────                              ──────
 page (SSR) ── carries ID, the class on ◄──  worker/src/lib/tracking.ts decides whether
 this page, the script                       this request may be measured at all
 marketing/analytics.js ─── events ──────────────────────────────────────────────────►  Google Analytics 4
                                                                                            (gtag.js, loaded by the script)
 Admin → Analytics ──► /api/admin/analytics/* ── signs a note with the service-account key ──► sign-in
                              (worker/src/lib/ga4.ts)                                       ◄── a pass (1 hour)
                                                  ── asks the Analytics Data API ─────────►  numbers
                              joins them with the shop's own orders (D1), keeps the answer 10 minutes (KV)
```

* **One door for events.** The script defines `window.mawahTrack(name, params)`. The public site’s own clicks and views are caught by the script itself (one listener for the whole page); the student app (a React single-page app) calls `track()` from `app/src/lib/analytics.ts`, which is `window.mawahTrack`. Nothing is sent until the script decides it may.
* **Only the real site.** `worker/src/lib/tracking.ts` allows measuring only in production on the public address (`SITE_URL`). The free `*.workers.dev` address (the deploy checks and the live smoke test use it), a developer’s machine and the automatic tests carry **no tag, no script, no policy for Google, no cookie** — the pages are byte-for-byte what they were before. On a developer’s machine counting can be switched on with `ANALYTICS_DEV=true` (never honoured in production).
* **Test browsers are not visitors.** A browser that announces itself as automated (`navigator.webdriver`, “HeadlessChrome”, Lighthouse, well-known bots and uptime checkers) is not counted, so test runs, Lighthouse and uptime checks cannot add made-up visits to the owner’s numbers.
* **Fast.** The script is ~11 KB, loaded with `defer`; Google’s tag is requested only after the page has finished loading and the browser is idle (`requestIdleCallback`, at the latest after two seconds). It adds nothing to the Core Web Vitals the Lighthouse gate measures (and the gate never counts, see above).
* **The page cache stays shared.** Pages are cached for everybody, so a page cannot say “this visitor is in Europe”. Cloudflare knows the visitor’s country (`CF-IPCountry`); `worker/src/middleware/geo.ts` leaves one small cookie, `mawah_geo=eu|row` (one day, no personal data), on measured HTML pages. The script reads it to decide whether to ask first.

## 2. Who is counted

| Visitor | Counted? |
|---|---|
| Anyone outside Europe, the UK and Switzerland | **Yes**, unless one of the rows below applies |
| Visitors in the EU/EEA, the UK, Switzerland (and Tor, `T1`) | **Only after they press “Accept”** on the question that appears at the bottom of the page (in their language); “No thanks” is final and remembered |
| A browser with **Do Not Track** or **Global Privacy Control** switched on | **Never** |
| Anyone who pressed **“Stop counting my visits”** in the footer | **Never** on that device (until they press “Count my visits again”); Google’s own `ga-disable-<ID>` switch is set too |
| Test browsers, Lighthouse, bots, uptime checks | **Never** |
| The admin (`/admin`) | **Never**: no tag in the page, none in its security policy |

What is sent — and what never is:

* **Sent:** class names (English, so the owner’s reports read the same in either language), the class’s address name (its slug) as the *item id*, category, price, currency (`BDT`), order numbers (the public order id, not a sequence number), coupon codes, simple choices (the payment service, a rating, a language), the page the visitor is on, and the place on the page a click came from.
* **Never sent:** names, e-mail addresses, phone numbers, addresses, passwords, anything a person typed into a form or a chat (the chat assistant sends only “a question was asked” and its number in the conversation), the text of a question to an instructor, a payment transaction ID or a payer’s number. As a last line of defence the script cuts out any value that looks like an e-mail address or a phone number before it leaves the page. `allow_google_signals` and ad personalisation are switched off in the tag’s configuration — no advertising features.
* The privacy policy (*Admin → Settings → Policies*) should say that the site uses Google Analytics, what is counted and how to opt out. The footer link and the question for Europe already do the work; the text is the owner’s to write.

## 3. Switching it on

### 3.1 The tag (already done)

Migration `0013` puts `G-J0R62NQJD4` in *Admin → Settings → Analytics* when it is empty. After the next deploy the real site carries the tag. Check:

1. Open the site in a normal browser (not private mode with blockers). In Google Analytics → *Reports → Realtime* you appear within a minute.
2. For a closer look open any page with **`?ga_debug=1`** at the end of its address and watch *Admin → DebugView* in Google Analytics: every event arrives with its parameters.
3. In the data stream (*Admin → Data streams → the web stream → Enhanced measurement*) keep **Page views** (with “Page changes based on browser history events” — the student app is a single-page app), **Scrolls**, **Outbound clicks**, **Site search** (the class list searches with `?q=`) and **File downloads** ON. **Form interactions** and **Video engagement** can be OFF: the site sends its own `generate_lead`.
4. *Admin → Data collection and modification → Data retention*: choose 14 months. *Admin → Data display → Events*: mark `purchase`, `generate_lead` and `sign_up` as **key events**.

If something is wrong the dashboard’s **Analytics** card says so (no ID set · key not added yet · last look at Google failed).

### 3.2 Connecting the admin screen (once, about ten minutes)

Needed only for **Admin → Analytics**. Counting visits works without it.

1. **Google Cloud** (<https://console.cloud.google.com>) — choose or create a project (no billing needed) → *APIs & Services → Library* → “**Google Analytics Data API**” → **Enable**.
2. Same project → *IAM & Admin → Service accounts → Create service account* (any name; no roles needed) → open it → *Keys → Add key → Create new key → JSON*. A file downloads. **That file is like a password.** Never paste it in a chat, a screenshot or an e-mail.
3. **Google Analytics** → *Admin → Property access management → + → Add users*: type the service account’s e-mail address (it ends with `.iam.gserviceaccount.com`; *Admin → Analytics* shows it once the key is in), role **Viewer**, untick “Notify new users by e-mail”, save. Do it on property `559265538`, not another one.
4. **GitHub** → the repository → *Settings → Secrets and variables → Actions → New repository secret*: name **`GA4_SERVICE_ACCOUNT_JSON`**, value = the **whole content of the file** (from the first `{` to the last `}`; the file itself or its base64 text both work). Then *Actions → Deploy → Run workflow*. The deploy checks the shape (a part of the file, an e-mail address alone, a user’s own login file or a public key is refused and said so, never echoed), stores it on the Worker as a secret on **one line**, and never prints it. A key set directly in Cloudflare (*Worker → Settings → Variables and Secrets*) also works and is left alone when there is no GitHub secret.
5. *Admin → Analytics → Check the connection*. The first numbers appear within a minute; a new tag may need an hour or two before Google shows its first visitors.

**Changing the key:** make a new key in Google Cloud, replace the GitHub secret, run Deploy, press *Check the connection*; then delete the old key in Google Cloud.

**If the key was shown anywhere** (a chat, a screenshot, a commit): delete it in Google Cloud (*Service accounts → the account → Keys → delete*) and make a new one. Deleting is the only cure.

### 3.3 When the screen says no

Each message names one step and what to do next; Google’s own words are shown under it (with anything shaped like a key cut out).

| The screen says | What it means | What to do |
|---|---|---|
| Google is not connected yet | no `GA4_SERVICE_ACCOUNT_JSON` on the Worker | steps 3.2.1–4 |
| The key file cannot be read | the secret is not a service-account key file, or was cut off when pasted | copy everything from `{` to `}` again; run Deploy |
| Google did not accept the key | the key was deleted or switched off, or is another account’s | make a new key (3.2.2), replace the secret, Deploy |
| The Analytics Data API is switched off | step 1 is missing in this project | enable it (the message from Google includes the link); wait a minute |
| The account cannot see your Analytics yet | step 3 is missing, or on another property, or with a role that cannot read | add the e-mail shown on the screen as **Viewer** on property `559265538` |
| Google could not find the property | `GA_PROPERTY_ID` is wrong | *Admin → Property details* in Google Analytics shows the number; change it in `worker/wrangler.toml` |
| Google did not understand one of our questions | a field name the Data API does not know — a bug in the website, not in the set-up | send the “Google said” line to the developer; the other panels still work |
| Too many questions for now | Google’s hourly limit | wait an hour; the screen keeps each answer for ten minutes |

Google Cloud sometimes refuses to *create* a key (“Service account key creation is disabled”). That is an organisation policy of Google Workspace; it does not apply to a project under a personal Google account. Either create the project under a personal account or ask the organisation’s administrator to allow key creation for this project.

### 3.4 What the numbers mean

* **Google’s numbers are not live and not exact.** They can be hours behind; visitors who say no (and some ad blockers) are not counted, so the real number of visitors is a little higher. “People” counts a person who read a class in both languages once in each language.
* **“Paid sales” and “Money” come from the shop’s own orders**, not from Google, and are exact (a free enrolment is not a sale; a refund is not a sale). *Reports → Revenue* is the book of record. “Paid (Google saw)” is what the browser reported; it is lower when a buyer closes the tab before the order page loads, or has counting switched off.
* **A purchase is counted once per order and device**, when the buyer’s browser shows the paid order (a reload does not count it again). A manual payment counts as a sale only when staff have confirmed it and the buyer opens the order again; the shop’s own “Paid sales” does not depend on that.
* **Server-side purchase tracking (Measurement Protocol) is not built.** It would need an `api_secret` and would make “Paid (Google saw)” match the shop’s records exactly; the on-screen note says why the two can differ.
* Everything on the screen is a number Google (or the shop’s database) returned. A panel Google could not answer says so; nothing is estimated or filled in.

## Every event

Names follow Google’s recommended events where one exists (`view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase`, `sign_up`, `login`, `generate_lead`, `select_item`, `view_item_list`, `view_promotion`, `select_promotion`), so Google’s own e-commerce reports work. The owner sees plain-words names for each in *Admin → Analytics → What else people did* (`adm.an.ev.<name>` in `shared/src/i18n/admin.ts`). A class is always an **item** `{ item_id: <slug>, item_name, item_category, price, quantity }`.

### Buying — the path from reading a class to paying

| Event | When | Carries |
|---|---|---|
| `view_item` | a class page is opened | currency, value (the price), the class as an item |
| `add_to_cart` | “Enroll now” is pressed (the button that leads to the checkout) | currency, value, the item, `placement` (buy box, sticky bar, card, banner…) |
| `begin_checkout` | the checkout opens with a basket (once per basket) | currency, value, coupon, items |
| `add_payment_info` | “Pay” is pressed | currency, value, coupon, `payment_type` (`mock`, `sslcommerz`, `manual_bkash`, `free`…), items |
| `purchase` | the order page shows the order paid (once per order and device) | `transaction_id` (public order id), currency, value, coupon, `payment_type`, items |
| `payment_pending` | a manual payment is waiting for the team’s check | same as `purchase` |
| `payment_proof_sent` | the buyer sent a TrxID and/or a screenshot | order id, `payment_type`, `has_trxid`, `has_screenshot` (never the TrxID itself) |
| `payment_failed` | the order page shows a failed or cancelled payment | same as `purchase`, `reason` |
| `coupon_applied` | a coupon was accepted | `coupon` |
| `coupon_failed` | a coupon was refused | `coupon`, `reason` (the error code) |
| `checkout_error` | the checkout could not be completed | `code` (the error code) |

### Looking around

| Event | When | Carries |
|---|---|---|
| `view_item_list` | a list of classes comes on screen (home “featured”, home “start here”, *All classes*, “related classes”) — once per list | `item_list_id`, `item_list_name`, the visible classes as items with their `index` |
| `select_item` | a class is chosen from a list | the item with `index`, `item_list_id`, `item_list_name` |
| `view_promotion` | a home slide is mostly on screen, or the offer pop-up opens | `promotion_id` (`hero-3`, `offer-7`), `promotion_name` (its headline), `creative_name`, `creative_slot`, `location_id` |
| `select_promotion` | a slide or the offer’s button is clicked | the same |
| `popup_dismiss` | the offer pop-up is closed | `promotion_name`, `method` (`close` or `no_thanks`) |
| `faq_expand` | a question is opened (*FAQ* page, home, a class) | `question` (the question’s own text), `placement` (`site`, `home`, `class`) |
| `language_switch` | the language button | `from`, `to` |
| `view_search_results` | the class list is searched (`?q=`) — **sent by Google itself** (enhanced measurement), so the screen can show the words searched | `search_term` |
| `file_download` | a file link is followed — **sent by Google itself** | `file_name`, `file_extension`, `link_url` |

### Asking and contacting

| Event | When | Carries |
|---|---|---|
| `generate_lead` | a form went through: contact, “notify me” on a coming-soon class, newsletter | `lead_type`, `course` (the class, for “notify me”), `placement` — never what was typed |
| `contact_click` | WhatsApp, phone, e-mail, Facebook, Instagram or YouTube link pressed | `method`, `placement` |
| `shop_click` | the Shop link | `placement` |
| `chatbot_open` | the chat assistant is opened | `placement` |
| `chatbot_message` | the visitor asked it something | `turn` (how many questions so far) — not the text |
| `chatbot_handoff` | the assistant passed the visitor on to a person | — |
| `certificate_verify` | the public certificate check was used | `result` (`found` or `not_found`) |

### Learning — what students do after paying

| Event | When | Carries |
|---|---|---|
| `lesson_start` | a lesson is opened | `course`, `lesson_id`, `lesson_type` |
| `lesson_complete` | a lesson is marked as done | `course`, `lesson_id` |
| `course_complete` | the last lesson of a class is done | `course` |
| `certificate_earned` | a certificate was issued by finishing | `course` |
| `certificate_view` | a certificate is opened | `course` |
| `review_submit` | a review is sent | `course`, `rating` |
| `question_ask` | a question to the instructor is sent | `lesson_id` — not the text |
| `material_open` | a link, live-class or group material is opened | `material_id`, `material_type` |
| `material_join_request` | a request to join a private group is sent | `material_id` |
| `material_download` | a material file is downloaded | `material_id`, `material_type` |
| `resource_download` | a lesson file is downloaded | `resource_id` |
| `invoice_download` | an invoice is opened | `transaction_id` |

### Accounts

| Event | When | Carries |
|---|---|---|
| `sign_up` | an account was made — by the register form, or by buying without logging in | `method` (`email` or `checkout`) |
| `login` | a student signed in | `method` (`email`, `student_id` or `phone`) |
| `account_secured` | a buyer who was signed in at checkout chose a password | — |

`scripts/lib/analytics-events.test.mjs` fails when a page sends an event that is not listed here and in `GA_EVENTS`, when a listed event is sent by nothing (apart from the two Google sends itself), when a name is one Google reserves, when an event call carries a key that names personal data, or when an event is missing from this page.

## 4. For developers

**Files**

| File | What it does |
|---|---|
| `shared/src/analytics.ts` | `GA_EVENTS` (name, group, “sent by Google”), `GA_EVENT_GROUPS`, `GA_FUNNEL` |
| `worker/src/lib/tracking.ts` | `measuringAllowed`, `trackingFor` (validated IDs, per request), `regionOf` |
| `worker/src/middleware/geo.ts` | the `mawah_geo` cookie |
| `worker/src/views/ga.ts`, `layout.tsx` | the class as an item (`data-ga-item`), lists (`data-ga-list`), the page’s `#mawah-ga` note, the footer switch |
| `worker/src/routes/spa.ts` | adds the tag and the script to the student app’s shell (never the admin’s) |
| `marketing/analytics.js` | the script: who may be counted, consent, the footer switch, the public site’s events |
| `app/src/lib/analytics.ts` | `track()`, `gaItem()`, `firstTime()` for the student app |
| `worker/src/lib/ga4.ts` | key file → signed note → pass → Data API; every failure named (`Ga4Problem`) and scrubbed |
| `worker/src/services/analytics.ts` | the questions asked of Google, joined with the shop’s paid sales |
| `worker/src/routes/api/admin/analytics.ts` | `GET status · report · classes.csv · realtime` (`analytics:read`: Super Admin, Content Manager, Viewer), `POST check · refresh` (`analytics:manage`: Super Admin; hourly caps) |
| `worker/src/routes/api/dev-google.ts` | a stand-in for Google (404 in production) used by the browser tests |
| `admin/src/pages/Analytics.tsx` | the screen |

**Adding an event.** Add it to `GA_EVENTS` (and give it a plain-words name `adm.an.ev.<name>` in both languages), send it with `track("name", {…})` in the app or `emit("name", {…})` in `marketing/analytics.js`, describe it above. `npm test` tells you what you forgot.

**Local use.** `ANALYTICS_DEV=true` in `worker/.dev.vars` (see `.dev.vars.example`) lets pages carry the tag on your machine once an ID is typed in *Settings → Analytics*; with the real shop’s ID your own browsing would be counted, so leave it off unless you need it. `GOOGLE_API_BASE=http://127.0.0.1:8787/api/dev/google` sends the report’s questions to the stand-in, which answers like Google and can be told to refuse in each of the ways Google can (`POST /api/dev/google/scenario {"scenario":"api_disabled"}` — also `no_access`, `key_rejected`, `quota`, `down`, `ok`). Neither is honoured in production.

**Tests.** `worker/test/analytics.test.ts` (who is measured, the pages, the app shell, the key file and the real signature, the sign-in and its failures, the report, the admin rules, the dashboard card), `scripts/lib/analytics-events.test.mjs` (the events), `scripts/lib/setup-cloudflare.test.mjs` (the deploy secret), `e2e/18-analytics.spec.ts` (a real browser: what a visitor does, Do Not Track, Europe, the footer switch, a purchase from the checkout, the admin screen against the stand-in with a made-up key).

**Not verified against the real Google.** The code, the signature and every failure path are tested against a stand-in; the real Data API has not been called from here. The field names in `services/analytics.ts` (`itemsCheckedOut`, `itemPromotionName`, `searchTerm`, `sessionSourceMedium`, `unifiedScreenName` …) are from Google’s documentation; each panel is asked separately, so a name Google does not accept blanks one panel and shows Google’s message instead of breaking the screen.
