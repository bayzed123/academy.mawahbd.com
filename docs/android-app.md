# MAWAH Academy for Android

*বাংলা সারাংশ নিচে · Bangla summary below.*

The Android app is in `mobile/` (React Native + Expo, TypeScript). It reads the **same server as the website**, so when you add a
class, a lesson, a price or a banner in Admin, the app shows it at once. You only need a new app build when the app itself changes.

## What the app does (and does not do)

It is a **study app**: students buy classes on the website, as today, and study in the app. It also has **free classes of its own**.

* **Home:** the app's notice (when the owner sets one), "continue where you stopped", my classes, the **free classes**, the free demo
  classes and the shop.
* **Free classes** (Admin → Android app): a class whose editor says *Where is this class shown? → Android app only — free*. It is free in
  the app for anyone with an account, and the website never lists, shows or sells it. The student taps **Start for free**: the class is
  theirs at once (no order, nothing bought) and opens like any other class. Signed out, the same button opens **Make a free account**:
  name, mobile number and password (an e-mail only if they want); they log in later with the number or their student ID.
* **My classes → a class:** progress, lessons by part, class materials (files, links, live classes, private groups), the certificate.
* **A lesson:** the video in the phone's own player (full screen, smooth), "Mark as done", the notes, downloads, next/previous lesson.
  Screenshots and screen recordings are blacked out while a lesson is open.
* **FoodCost** (its own tab): one's recipes and what each costs and sells for; a recipe costed while one types (lines, packaging, labour,
  gas, markup or margin, one's real price), with the cost and price in a bar at the bottom; ingredients & prices (the Dhaka average the
  owner keeps, or one's own price). Free keeps 3 recipes, said plainly with nothing about buying; MAWAH students have no limit.
  The same server and the same costing as the website ([foodcost.md](foodcost.md)).
* **Notifications** (once Firebase is set up: [section 5](#5-notifications-firebase-once)): Home offers them once — **Allow** (the phone then
  asks its own question), **Not now**, or ✕ — and *Profile → Notifications* switches them on and off. They arrive with the app closed:
  a new free class going live (to everyone), a new lesson in a class (to its students, at most once in 12 hours per class), and the
  owner's own from *Admin → Android app → Notifications*. A tap opens the class. Each phone gets them in its own language.
* **Shop:** the equipment shop with categories. **Order now** opens the product on the website's secure page (cash on delivery or online).
* **Profile:** student ID, language (বাংলা / English), look (night / day / like the phone), certificates, WhatsApp / call / Messenger /
  e-mail, policies, log out, and **Delete my account** (Google Play rule; see below).
* Bangla first, like the website. Night look by default. On a tablet the screens keep a centred column (at most 760 points wide) and the
  shop shows 3 or 4 products in a row.

**Google Play rule.** Digital things bought *inside* an app must use Google Play Billing. So the app **never** shows a class's price,
never offers to buy a class, and never sends anyone to pay for a class elsewhere. The equipment shop sells physical goods, which may be
ordered and paid for anywhere (SSLCommerz, cash on delivery). `mobile/src/strings.test.ts` fails if a class "buy" or "price" word slips
into the app.

## 1. Make the upload key (once, on your own computer)

Google keeps the app's real signing key (Play App Signing). You keep an **upload key**: every file sent to Google is signed with it.
Make it on **your own computer**, never on someone else's, and never put it in the repository (it is public) or in a chat.

**Windows (easiest):** copy `mobile/scripts/make-upload-key.ps1` into a new folder outside the project (for example
`Documents\mawah-keys`), open PowerShell there and run:

```powershell
powershell -ExecutionPolicy Bypass -File make-upload-key.ps1
```

It finds `keytool` (from Java 17 or Android Studio), asks for a password twice, makes `mawah-upload.jks` and copies the text GitHub needs.

**Mac or Linux:** the same with `bash make-upload-key.sh` (it writes the text to `mawah-upload.base64.txt`).

**By hand:**

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore mawah-upload.jks -alias mawah-upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=MAWAH Academy, O=MAWAH Academy, C=BD"
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\mawah-upload.jks")) | Set-Clipboard
```

**Back it up:** copy `mawah-upload.jks` and the password to two safe offline places (a USB stick and a password manager). If it is lost,
Google can reset the upload key from Play Console, but that takes a few days.

## 2. Put it in GitHub (4 secrets)

GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret** (only the repository's owner sees Settings):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the long text the script copied (or the contents of `mawah-upload.base64.txt`) |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `mawah-upload` |
| `ANDROID_KEY_PASSWORD` | the same password (this kind of key file has one password for both) |

## 3. Get a build (AAB + APK)

1. GitHub → **Actions → Android app → Run workflow** (it also runs by itself on every change to `mobile/` or `shared/` on main).
2. Wait about 20–30 minutes. Open the finished run → **Artifacts**:
   * `…-aab`: the **AAB**, the file you upload to Google Play.
   * `…-apk`: the **APK**, to install straight on a phone (the phone asks to allow installing from this source once).
3. The run's summary says which key signed it. Before the 4 secrets exist, and in every pull request, a throwaway **test key** signs it:
   the APK installs and works, but Google Play refuses that AAB (its file name ends in `TEST-KEY`).

The version code (a number Google needs to grow with every upload) is set by the workflow from the time of the build. The version name
people see (1.0.0) is `version` in `mobile/package.json`: raise it for a new release.

The workflow checks the key before it builds (a wrong password or alias stops it in a minute, with the reason), and checks the finished
files' signatures afterwards.

## 4. Google Play: the first release

1. Play Console → **Create app**: name *MAWAH Academy*, default language *Bangla* (bn-BD), *App*, *Free*.
2. **Testing → Internal testing → Create release** → upload the AAB. Google turns on **Play App Signing** with your upload key.
3. **Personal developer account made after 13 Nov 2023?** Google asks for a **closed test with at least 12 testers opted in for 14 days in
   a row** before production. Start it early (*Testing → Closed testing*); keep updating the build during the 14 days.
   An organization account (needs a free D-U-N-S number) does not have this rule.
4. **App content** (Policy → App content):
   * **Privacy policy:** `https://mawahacademy.com/policies/privacy`
   * **App access:** some screens need a login → *All or some functionality is restricted* → **Admin → Android app → Google Play test
     account → Make the test account**, and give Google its **student ID** (as the username) and the **password** shown (shown once:
     copy it at once; *New password* makes another and signs the old one out everywhere). Instructions for the reviewer, in English:
     "Sign in with the student ID and password. The free classes are on Home: tap one, then Start for free." To let the reviewer see a
     website class too, give the account that class in *Admin → Students* (the page links there).
   * **Ads:** no ads.
   * **Content rating:** fill in the questionnaire (an education app).
   * **Target audience:** 18 and over (unless children are your students: under 13 brings in Google's family rules).
   * **Data safety** (the answers to give):
     * *Does the app collect or share user data?* Collects: yes. Shares: **no** (nothing goes to advertisers or data brokers; the
       payment and hosting services work for us, which Google does not count as sharing).
     * *Encrypted in transit?* Yes (HTTPS). *Can users ask for deletion?* Yes (next point).
     * *Data types collected* — all **required**, for **App functionality** and **Account management**, not for advertising (an
       account is made in the app — *Make a free account* — or on the website):
       * Personal info: **Name**, **Phone number**, **Email address** (only when given: it is optional), **User IDs** (the student ID)
       * Financial info: **Purchase history** (classes and orders)
       * App activity: **Other user-generated content** (questions, reviews, and FoodCost recipes, ingredients and prices),
         **App interactions** (lessons finished, downloads)
       * Device or other IDs: **Device or other IDs** — *optional* (only when the person allows notifications), for **App
         functionality**: the address Google's Firebase Cloud Messaging gives the app, kept with the app's language and, when signed
         in, the account, so notifications reach the phone. Not shared.
     * The app collects no location, contacts, photos, files or audio, no advertising ID, and has no advertising or analytics library.
     * **Health and fitness:** none. FoodCost shows the calories and nutrients of a *recipe* (from food tables and what the user typed
       for an ingredient); it keeps nothing about anyone's body, diet, eating or activity, so the Data safety form has no health data.
   * **Health apps declaration** (App content → *Health apps*, asked of every app): FoodCost's calories are recipe information for
     bakers, not tracking of what a person eats. If the form asks whether the app has health features, the honest answer is that it
     shows recipe nutrition; when a category must be picked, *Nutrition and weight management* is the closest one. It brings no extra
     requirement for an app that stores no health data, but read Google's wording on the day: it changes.
   * **Account deletion:** in the app *Profile → Delete my account*; on the web **https://mawahacademy.com/account/delete** (give this
     address under *Delete account URL*). Deleting removes the name, number, e-mail, address, password, progress, questions, reviews and FoodCost data, unlinks the phones it got notifications on,
     ends every sign-in, and keeps orders and payments for tax records (the page says so, as Google requires). Staff can also delete an
     account on request (*Admin → Students → Delete account*).
   * **Privacy policy** covers the app: a section about the Android app and deleting an account is always shown under the privacy text.
5. **Store listing:** name (30 letters), short description (80), full description, the 512×512 icon (`mobile/assets/icon.png` resized),
   a 1024×500 feature graphic and 2–8 screenshots each for phone, 7-inch tablet and 10-inch tablet, in Bangla and English (PNG or JPEG
   without transparency; the long side at most twice the short side).
6. **Web addresses Play Console asks for** (all in Bangla, and in English under `/en`):

   | Field | Address |
   |---|---|
   | Privacy policy | https://mawahacademy.com/policies/privacy |
   | Delete account | https://mawahacademy.com/account/delete |
   | Website | https://mawahacademy.com |
   | Terms (for the listing text, if you link it) | https://mawahacademy.com/policies/terms |
   | Contact | https://mawahacademy.com/contact (and the support e-mail from Settings → Contact) |
7. Target API level: the app targets **Android 16 (API 36)**, which Google requires for new apps.

## 5. Notifications (Firebase, once)

Google delivers Android notifications through **Firebase Cloud Messaging** (free). Set it up once; until then the app builds and works the
same and simply never offers notifications, and *Admin → Android app → Notifications* says what is missing.

1. Open **https://console.firebase.google.com** with the Google account you use for the website → **Create a project** → name it
   *MAWAH Academy* → Google Analytics for this project: **off** (not needed) → **Create project**.
2. In the project: **Add app → Android** → *Android package name*: **`com.mawahacademy.app`** (exactly) → nickname *MAWAH Academy* →
   **Register app** → **Download google-services.json** → skip the remaining steps (the build does them).
3. GitHub → **Settings → Secrets and variables → Actions → New repository secret**: name **`GOOGLE_SERVICES_JSON`**, value: the whole
   `google-services.json` (open it in Notepad, select all, copy). The Android build checks it is the file for `com.mawahacademy.app`.
4. Firebase → ⚙ **Project settings → Service accounts → Generate new private key → Generate key**: a `.json` file downloads. New
   repository secret **`FIREBASE_SERVICE_ACCOUNT`** = that whole file. It is a password: never paste it in a chat or an e-mail.
5. Firebase → ⚙ **Project settings → Cloud Messaging**: *Firebase Cloud Messaging API (V1)* should say **Enabled** (if not: ⋮ → *Manage
   API in Google Cloud Console* → **Enable**).
6. GitHub → **Actions → Deploy → Run workflow** (gives the website its key), then **Actions → Android app → Run workflow** (builds the app
   with notifications) → upload the new AAB to Google Play. People get notifications once they have this version of the app.
7. **Admin → Android app → Notifications → Check the connection**: it should say *Connected*. Then on a phone with the new app: Home →
   **Allow**, and send yourself a test from the same page.

What goes out: a new free class going live (everyone, once per class), a new lesson in a live class (its students, at most once in 12
hours per class) — each can be switched off on that page — and the owner's own (everyone, or one class's students; a tap opens Home, a
free class or a demo, or the class). Nothing in them is about buying (Google Play rule above). Every one is listed under *Sent lately*.

How it works: the app gives the website the address Google made for it, with its language; the website adds it to Firebase "topics" —
`lang-bn` / `lang-en`, and `class-<id>` for each class the signed-in student studies — and sends one message per language to a topic, or
to "this class and this language". The code: `worker/src/lib/fcm.ts`, `worker/src/services/push.ts`, `mobile/src/push.tsx`.

## For developers

```bash
cd mobile
npm ci
npm run check            # TypeScript + the app's own tests (Node test runner)
npx expo start           # then press "a" for an Android emulator, or scan the QR code with Expo Go
```

* The API address is `https://mawahacademy.com`; point a test build elsewhere with `EXPO_PUBLIC_API_URL`.
* `mobile/` is **not** an npm workspace of the website (its React and React Native versions differ); it shares `shared/` (types, money and
  date helpers) through `"@mawah/shared": "file:../shared"` and Metro's `watchFolders`.
* The Android project (`mobile/android`) is made fresh by `expo prebuild` in every build and never committed;
  `mobile/plugins/with-release-signing.js` adds the release signing (from the workflow's environment) and Gradle memory.
* **Sign-in:** `POST /api/auth/login` with `"client": "app"` returns a session token instead of a cookie; the app keeps it in Android's
  encrypted storage (`expo-secure-store`) and sends `Authorization: Bearer …`. Students only: staff sessions are never read from a header.
  Logging out ends that token; a password change, a block or "log out everywhere" ends it too.
* **Free classes:** `GET /api/app/courses` (the live app classes), `GET /api/app/courses/:slug` (one, with its lessons' titles and, for a
  signed-in student, `joined` / `revoked`), `POST /api/app/courses/:slug/join` (an enrolment with source `free` and no order; a class
  staff took back stays taken back). `courses.channel` is `website` or `app` (migration 0023); every website list, page, search, sitemap,
  checkout and bundle reads only `website` classes (`ON_WEBSITE` in `worker/src/services/catalog.ts`).
* **Sign-up:** `POST /api/auth/app-register` (name, phone, password, optional email, lang) answers like an app login (a token). Without an
  e-mail the number is the account (`p<number>@no-email.invalid`), so a number that has an account already is refused (`phone_taken`).
* **Notice:** `/api/site` → `site.app_notice` (`{ bn, en }` or null), saved in Admin → Android app (setting key `app`).
* Icons are drawn from the website's `marketing/public/sprite.svg` (`node scripts/gen-icons.mjs` rebuilds `src/ui/iconData.ts`).

## Known limits

* Classes cannot be bought in the app (Google Play rule above). A student who joined on the website logs in with the same account.
  The app's own free classes are free; a student who has one also sees it in the website's student area (it is their class), but the
  website never lists it.
* Only **live** app classes are in the app: a draft or "coming soon" app class is not shown there yet.
* `/api/site` may be kept for up to a minute, so a new notice reaches open apps within about a minute.
* "Forgot password" opens the website's page in the browser.
* Notifications need the internet: a phone that is offline gets them when it is back online, if that is within a week (older news is
  dropped). Some phone makers' battery savers can hold them back until the app is opened. A phone that turned them off in its own
  settings gets none (Profile then offers *Open settings*). A test build (no `GOOGLE_SERVICES_JSON`) has no notifications.
* Shop orders are placed on the website's page (opened from the app), not in an in-app cart.
* If Cloudflare Turnstile (the website's optional bot check) is switched on, logging in from the app stops working until the app gets a
  way to answer it.

---

## বাংলা সারাংশ

* অ্যাপটি `mobile/` ফোল্ডারে। ওয়েবসাইটের **একই সার্ভার** থেকে তথ্য নেয় — অ্যাডমিনে নতুন ক্লাস, লেসন বা দাম দিলে অ্যাপে সাথে সাথে দেখা যায়। নতুন বিল্ড লাগে শুধু অ্যাপ নিজে বদলালে।
* **অ্যাপে ক্লাস কেনা যায় না** (গুগল প্লের নিয়ম): শিক্ষার্থীরা ওয়েবসাইটে কেনেন, অ্যাপে পড়েন। ইকুইপমেন্ট শপের পণ্য অর্ডার হয় ওয়েবসাইটের নিরাপদ পাতায়।
* **অ্যাপের ফ্রি ক্লাস:** অ্যাডমিন → ক্লাস → নতুন ক্লাস → “ক্লাসটি কোথায় দেখানো হবে?” → **শুধু অ্যান্ড্রয়েড অ্যাপে — ফ্রি** (অথবা অ্যাডমিন → অ্যান্ড্রয়েড অ্যাপ → **ফ্রি ক্লাস যোগ করুন**)। ক্লাসটি অ্যাপে সবার জন্য ফ্রি; ওয়েবসাইটে কখনো দেখানো বা বিক্রি হয় না। শিক্ষার্থী অ্যাপে “ফ্রি শুরু করুন” চাপলেই ক্লাসটি তাঁর হয়ে যায় (কোনো অর্ডার নেই)। অ্যাকাউন্ট না থাকলে অ্যাপেই **ফ্রি অ্যাকাউন্ট খুলুন** — নাম, মোবাইল নম্বর, পাসওয়ার্ড (ইমেইল চাইলে)।
* **গুগল প্লের টেস্ট অ্যাকাউন্ট:** অ্যাডমিন → অ্যান্ড্রয়েড অ্যাপ → **টেস্ট অ্যাকাউন্ট তৈরি করুন** → যে স্টুডেন্ট আইডি ও পাসওয়ার্ড দেখাবে (শুধু একবার), সেটি Play Console → App content → App access-এ দিন। হারালে “নতুন পাসওয়ার্ড” চাপুন।
* **অ্যাপের নোটিশ:** অ্যাডমিন → অ্যান্ড্রয়েড অ্যাপ → নোটিশ (বাংলা ও ইংরেজি) → “নোটিশ দেখান” → সংরক্ষণ। এক মিনিটের মধ্যে অ্যাপের হোমে দেখা যায়।
* **নোটিফিকেশন (একবার সেটআপ, উপরে ৫ নম্বর):** console.firebase.google.com → নতুন প্রজেক্ট → Android অ্যাপ যোগ করুন (প্যাকেজ নাম ঠিক `com.mawahacademy.app`) → `google-services.json` নামিয়ে GitHub সিক্রেট **`GOOGLE_SERVICES_JSON`**-এ পুরো ফাইলটি রাখুন → Project settings → Service accounts → **Generate new private key** → সেই ফাইলটি GitHub সিক্রেট **`FIREBASE_SERVICE_ACCOUNT`**-এ রাখুন (এটি পাসওয়ার্ডের মতো — চ্যাটে কখনো দেবেন না) → Actions → **Deploy** ও **Android app** চালান → নতুন AAB প্লেতে দিন → অ্যাডমিন → অ্যান্ড্রয়েড অ্যাপ → নোটিফিকেশন → **সংযোগ পরীক্ষা করুন**। অ্যাপ বন্ধ থাকলেও নোটিফিকেশন আসে; ফোন অফলাইন থাকলে এক সপ্তাহের মধ্যে ইন্টারনেট পেলে আসে।
* **আপলোড কী:** নিজের কম্পিউটারে `mobile/scripts/make-upload-key.ps1` চালান (উপরে ১ নম্বর)। তারপর GitHub → Settings → Secrets and variables → Actions-এ ৪টি সিক্রেট দিন (উপরে ২ নম্বর)। কী ফাইল ও পাসওয়ার্ড কখনো রিপোজিটরি বা চ্যাটে দেবেন না; দুই জায়গায় ব্যাকআপ রাখুন।
* **বিল্ড:** GitHub → Actions → Android app → Run workflow → শেষ হলে Artifacts থেকে `.aab` (গুগল প্লের জন্য) ও `.apk` (ফোনে সরাসরি ইনস্টলের জন্য) নামান।
* **গুগল প্লে:** পার্সোনাল অ্যাকাউন্ট (১৩ নভেম্বর ২০২৩-এর পরে খোলা) হলে প্রোডাকশনের আগে **১২ জন টেস্টার, টানা ১৪ দিন** ক্লোজড টেস্ট লাগবে — আগে থেকেই টেস্টার জোগাড় শুরু করুন।
* **প্লে কনসোলের ঠিকানা:** গোপনীয়তা নীতি `https://mawahacademy.com/policies/privacy`, অ্যাকাউন্ট ডিলিট `https://mawahacademy.com/account/delete`। অ্যাপে প্রোফাইল → **আমার অ্যাকাউন্ট ডিলিট করুন**; স্টাফ অনুরোধে অ্যাডমিন → শিক্ষার্থী থেকে ডিলিট করতে পারেন। অর্ডার ও পেমেন্টের রেকর্ড করের জন্য থেকে যায়।
