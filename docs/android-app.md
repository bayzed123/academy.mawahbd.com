# MAWAH Academy for Android

*বাংলা সারাংশ নিচে · Bangla summary below.*

The Android app is in `mobile/` (React Native + Expo, TypeScript). It reads the **same server as the website**, so when you add a
class, a lesson, a price or a banner in Admin, the app shows it at once. You only need a new app build when the app itself changes.

## What the app does (and does not do)

It is a **study app**: students buy classes on the website, as today, and study in the app.

* **Home:** "continue where you stopped", my classes, the free demo classes and the shop.
* **My classes → a class:** progress, lessons by part, class materials (files, links, live classes, private groups), the certificate.
* **A lesson:** the video in the phone's own player (full screen, smooth), "Mark as done", the notes, downloads, next/previous lesson.
  Screenshots and screen recordings are blacked out while a lesson is open.
* **Shop:** the equipment shop with categories. **Order now** opens the product on the website's secure page (cash on delivery or online).
* **Profile:** student ID, language (বাংলা / English), look (night / day / like the phone), certificates, WhatsApp / call / Messenger /
  e-mail, policies, log out.
* Bangla first, like the website. Night look by default.

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
   * **App access:** some screens need a login → give Google a test student (a mobile number and password) with one class.
   * **Ads:** no ads.
   * **Content rating:** fill in the questionnaire (an education app).
   * **Target audience:** 18 and over (unless children are your students: under 13 brings in Google's family rules).
   * **Data safety:** the app collects name, phone number, e-mail (when given) and purchase history (classes, orders), to run the student
     account; it is sent over HTTPS; nothing is shared with advertisers. Students can ask for their data to be deleted.
   * **Account deletion:** Google asks for a "Delete my account" in the app **and** a web address for it. This is the next piece of work
     (before you submit for review).
5. **Store listing:** name (30 letters), short description (80), full description, the 512×512 icon (`mobile/assets/icon.png` resized),
   a 1024×500 feature graphic and at least 2 phone screenshots, in Bangla and English.
6. Target API level: the app targets **Android 16 (API 36)**, which Google requires for new apps.

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
* Icons are drawn from the website's `marketing/public/sprite.svg` (`node scripts/gen-icons.mjs` rebuilds `src/ui/iconData.ts`).

## Known limits

* Classes cannot be bought in the app (Google Play rule above). A student who joined on the website logs in with the same account.
* "Forgot password" opens the website's page in the browser.
* Shop orders are placed on the website's page (opened from the app), not in an in-app cart.
* Account deletion (needed before Google's review) comes in the next pull request.
* If Cloudflare Turnstile (the website's optional bot check) is switched on, logging in from the app stops working until the app gets a
  way to answer it.

---

## বাংলা সারাংশ

* অ্যাপটি `mobile/` ফোল্ডারে। ওয়েবসাইটের **একই সার্ভার** থেকে তথ্য নেয় — অ্যাডমিনে নতুন ক্লাস, লেসন বা দাম দিলে অ্যাপে সাথে সাথে দেখা যায়। নতুন বিল্ড লাগে শুধু অ্যাপ নিজে বদলালে।
* **অ্যাপে ক্লাস কেনা যায় না** (গুগল প্লের নিয়ম): শিক্ষার্থীরা ওয়েবসাইটে কেনেন, অ্যাপে পড়েন। ইকুইপমেন্ট শপের পণ্য অর্ডার হয় ওয়েবসাইটের নিরাপদ পাতায়।
* **আপলোড কী:** নিজের কম্পিউটারে `mobile/scripts/make-upload-key.ps1` চালান (উপরে ১ নম্বর)। তারপর GitHub → Settings → Secrets and variables → Actions-এ ৪টি সিক্রেট দিন (উপরে ২ নম্বর)। কী ফাইল ও পাসওয়ার্ড কখনো রিপোজিটরি বা চ্যাটে দেবেন না; দুই জায়গায় ব্যাকআপ রাখুন।
* **বিল্ড:** GitHub → Actions → Android app → Run workflow → শেষ হলে Artifacts থেকে `.aab` (গুগল প্লের জন্য) ও `.apk` (ফোনে সরাসরি ইনস্টলের জন্য) নামান।
* **গুগল প্লে:** পার্সোনাল অ্যাকাউন্ট (১৩ নভেম্বর ২০২৩-এর পরে খোলা) হলে প্রোডাকশনের আগে **১২ জন টেস্টার, টানা ১৪ দিন** ক্লোজড টেস্ট লাগবে — আগে থেকেই টেস্টার জোগাড় শুরু করুন।
