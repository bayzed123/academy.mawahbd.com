# Google Play: every box, and what to write in it

This page tells you what to type into each box in Play Console, in order, for **MAWAH Academy** (package `com.mawahacademy.app`).
The pictures for the store (screenshots, feature graphic, icon, promo video) are in the kit made for this release. Building and
signing the app is explained in [android-app.md](android-app.md).

> **The honest timeline.** You cannot go straight to Production on a new personal developer account. Google's rule (on your
> Dashboard): first a **closed test with at least 12 testers who stay opted in for 14 days in a row**, then **Apply for
> production** (Google answers in up to about 7 days), then the production review (usually 1–3 days, sometimes up to 7).
> **Plan on about 3–4 weeks** from today until anyone can find the app on Google Play. Everything below can be filled in today.

## 0. Before you start

1. Merge the pull request with this release. Then wait for **GitHub → Actions → Android app** to finish on `main` (about 25 minutes).
2. Open that run. In its summary check: **Signed with: the upload key**, **Package: com.mawahacademy.app**, **Targets: Android API 36**,
   and the permission list. Under **Artifacts**, download `mawah-academy-1.0.0-<number>-aab`. GitHub gives a `.zip`: unzip it and
   you have the **`.aab`** file. A file whose name ends in `TEST-KEY` is refused by Google: the 4 signing secrets are missing.
3. Make the Google test account: **Admin → Android app → Google Play test account → Make the test account**. Copy its **student
   ID** and **password** now. The password is shown only once; *New password* makes another one.
4. Update your website texts (section 9): the refund and terms pages still say kits and tools cannot be ordered, but the
   Equipment Shop is open.

## 1. Create the app

Play Console → **Create app**:

| Box | Write / choose |
|---|---|
| App name | `MAWAH Academy` |
| Default language | `Bengali – bn-BD` |
| App or game | **App** |
| Free or paid | **Free** |
| Declarations | Tick both (Developer Program Policies, US export laws) |

## 2. Store listing (Grow users → Store presence → Main store listing)

Add a translation: **Manage translations → English (United States) – en-US**, and fill the same boxes in English.

| Box | Bangla (bn-BD) | English (en-US) |
|---|---|---|
| App name (max 30) | `মাওয়াহ একাডেমি` | `MAWAH Academy` |
| Short description (max 80) | `ঘরে বসে রান্না ও বেকিং শিখুন: ভিডিও ক্লাস, রেসিপির খরচ আর ক্যালরি হিসাব।` | `Learn cooking and baking at home: video classes, recipe costs and calories.` |
| Full description (max 4000) | below | below |
| App icon | `4-app-icon-512.png` | the same |
| Feature graphic | `3-feature-graphic/feature-graphic-bangla.png` | `…-english.png` |
| Video (optional) | your YouTube link (section 8) | the English one |
| Phone screenshots | `1-screenshots-with-captions/bangla/phone` (8, in number order) | `…/english/phone` |
| 7-inch tablet screenshots | `…/bangla/tablet-7-inch` | `…/english/tablet-7-inch` |
| 10-inch tablet screenshots | `…/bangla/tablet-10-inch` | `…/english/tablet-10-inch` |

### Full description — Bangla

```
মাওয়াহ একাডেমি হলো MAWAH-এর রান্না ও বেকিং স্কুলের নিজস্ব অ্যাপ। ঘরে বসে ধাপে ধাপে শিখুন কেক, পেস্ট্রি, মিষ্টি, ফাস্ট ফুড, বিরিয়ানি আর আরও অনেক কিছু — আর জেনে নিন প্রতিটি রেসিপির খরচ কত।

যা করতে পারবেন
• ফোনেই ভিডিও লেসন দেখুন, লেসন ধরে ধরে, নিজের গতিতে
• যেখানে থেমেছিলেন সেখান থেকেই আবার শুরু করুন; অগ্রগতি সেভ থাকে
• রেসিপির পিডিএফসহ ক্লাসের ম্যাটেরিয়াল ডাউনলোড করুন
• ক্লাস শেষ করলে সার্টিফিকেট পান
• অ্যাপের জন্য বানানো ফ্রি ক্লাস — লাগবে শুধু একটি ফ্রি অ্যাকাউন্ট
• ক্লাস কেনার আগে ফ্রি ডেমো লেসন দেখুন

ফুডকস্ট: রেসিপির খরচ হিসাব
• উপকরণ আর আপনার কেনা দাম লিখুন
• পুরো ব্যাচ আর প্রতি পিস বা স্লাইসের খরচ দেখুন
• প্যাকেজিং, আপনার সময় আর ওভেনের গ্যাস বা বিদ্যুতের খরচ যোগ করুন
• যত লাভ চান, সেই হিসাবে বিক্রির দাম জেনে নিন
• প্রতি পিসের ক্যালরি ও পুষ্টি (প্রোটিন, শর্করা, চর্বি, চিনি, আঁশ, সোডিয়াম) দেখুন, খাদ্য-তালিকা থেকে হিসাব করা

ইকুইপমেন্ট শপ
• MAWAH-এর বেকিং সরঞ্জাম ও উপকরণ, সারা বাংলাদেশে ডেলিভারি
• অর্ডার হয় আমাদের নিরাপদ ওয়েবসাইটে, ক্যাশ অন ডেলিভারি বা অনলাইন পেমেন্টে

আপনার মতো করে
• বাংলা বা English
• রাতের লুক বা দিনের লুক — ফোনের সেটিং মেনে, বা নিজের পছন্দে
• নতুন ফ্রি ক্লাস আর নতুন লেসনের নোটিফিকেশন (শুধু আপনি অনুমতি দিলে)
• কোনো বিজ্ঞাপন নেই

ক্লাস কেনা হয় mawahacademy.com-এ, আর একই অ্যাকাউন্টে অ্যাপে খোলে। অ্যাপেই যেকোনো সময় অ্যাকাউন্ট ডিলিট করতে পারেন (প্রোফাইল → আমার অ্যাকাউন্ট ডিলিট করুন)।

প্রশ্ন থাকলে অ্যাপের প্রোফাইল থেকে হোয়াটসঅ্যাপে লিখুন, অথবা দেখুন mawahacademy.com/contact
```

### Full description — English

```
MAWAH Academy is the app of MAWAH's cooking and baking school. Learn cakes, pastry, sweets, fast food, biryani and much more at home, step by step — and find out what every recipe costs.

WHAT YOU CAN DO
• Watch video lessons on your phone, lesson by lesson, at your own pace
• Carry on right where you stopped; your progress is saved
• Download class materials such as recipe PDFs
• Get a certificate when you finish a class
• Start free classes made for the app; all you need is a free account
• Watch free demo lessons before you buy a class

FOODCOST: RECIPE COSTING
• Add your ingredients and the prices you pay
• See the cost of the whole batch and of each piece or slice
• Add packaging, your time and the oven's gas or electricity
• Get a selling price from the profit you want
• See the calories and nutrition (protein, carbohydrate, fat, sugar, fibre, sodium) of each piece, worked out from food tables

EQUIPMENT SHOP
• MAWAH's baking tools and ingredients, delivered across Bangladesh
• Orders are placed on our secure website, with cash on delivery or online payment

MADE FOR YOU
• Bangla or English
• Night look or day look: it follows your phone, or your own choice
• Notifications about new free classes and new lessons (only if you allow them)
• No ads

Classes are bought on mawahacademy.com and open in the app with the same account. You can delete your account at any time in the app (Profile → Delete my account).

Questions? Message us on WhatsApp from the app's Profile page, or visit mawahacademy.com/contact
```

### App category and contact details (Store settings)

| Box | Write / choose |
|---|---|
| App or game / Category | App / **Education** |
| Tags (up to 5) | the closest ones Google offers, e.g. Cooking, Recipes, Online learning |
| Email address (shown on Google Play) | the shop e-mail from Admin → Settings → Contact (now `info@mawahbd.com`) |
| Phone number (optional) | the business number from Admin → Settings → Contact |
| Website | `https://mawahacademy.com` |
| External marketing | leave on |

## 3. App content (Policy → App content)

Answer each item; Play Console lists them on the Dashboard until each is done.

### Privacy policy
`https://mawahacademy.com/en/policies/privacy` (the English page; the Bangla page is the same address without `/en`). Under your own
policy text it always adds what Google asks for: what the app collects, who receives it (including the couriers and the website's
Google Analytics and Meta Pixel), how long it is kept, where it is stored, children, account deletion and who to ask.

### App access
**All or some functionality is restricted** → **Add instructions**:

| Box | Write |
|---|---|
| Name | `Test account` |
| Username | the test account's **student ID** (from step 0.3) |
| Password | the password shown with it |
| Any other information | `Sign in with the student ID and password above. The free classes are on Home: tap one, then "Start for free". FoodCost (recipe costing) is the third tab. The app is in Bangla first; Profile → Language switches to English.` |

### Ads
**No, my app does not contain ads.**

### Content rating
Start questionnaire → e-mail → category **Reference, News, or Educational**. Answer **No** to every question about violence, fear,
sexuality, language, drugs, alcohol, tobacco, gambling and crude humour. *Do users interact or exchange content?* **No** (the app has
no chat, comments or posts between users). *Shares location?* **No**. *Digital purchases in the app?* **No** (classes are bought on the
website). *Web browser or search engine?* **No**. Expected result: rated for everyone (3+).

### Target audience and content
* Target age groups: **18 and over** only. (Choosing an age under 13 brings in Google's Families rules.)
* *Could your store listing unintentionally appeal to children?* **No**.

### News apps
**No.**

### Data safety
| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Which methods of account creation does your app support? | **Username and password** (the mobile number or student ID, and a password) |
| Delete account URL | `https://mawahacademy.com/en/account/delete` |
| Can users delete some data without deleting the account? | **Yes**, in the app itself: FoodCost recipes, prices and ingredients each have Delete, and turning notifications off deletes the phone's address (the link box can stay empty) |

Data types — tick **Collected**, never **Shared** (the hosting, SMS and payment services work for us, which Google does not count as
sharing); *Processed ephemerally?* **No** for each; purposes **App functionality** and **Account management**:

| Data type | Required or optional | Purposes |
|---|---|---|
| Personal info → **Name** | Required | App functionality, Account management |
| Personal info → **Email address** | Optional | App functionality, Account management |
| Personal info → **User IDs** (the student ID) | Required | App functionality, Account management |
| Personal info → **Phone number** | Required | App functionality, Account management |
| Financial info → **Purchase history** (the classes the account owns) | Required | App functionality |
| App activity → **App interactions** (lessons finished, free classes started, downloads) | Required | App functionality |
| App activity → **Other user-generated content** (FoodCost recipes, ingredients, prices) | Optional | App functionality |
| Device or other IDs → **Device or other IDs** (the notification address from Firebase) | Optional | App functionality |

Not collected: location, contacts, photos and videos, audio, files, calendar, messages, web browsing, **health and fitness**, app info and
performance (no crash reporting or analytics in the app), advertising ID.

### Government apps
**No.**

### Financial features
**My app doesn't provide any financial features.**

### Health apps
FoodCost shows a recipe's calories and nutrition; it keeps nothing about anyone's body, diet or activity. When the form makes you pick,
choose **Nutrition and weight management** (the closest), never a medical category. Read Google's wording on the day: it changes.

### Advertising ID (if asked)
*Does your app use advertising ID?* **No** (the app's build removes that permission).

## 4. Trader status (EU Digital Services Act)

MAWAH sells classes and products as a business, so choose **I'm a trader**. Give the business details that are already public on the
website footer: business name, registered address, the business phone and e-mail. Google verifies them and shows them on the listing
in EU countries only.

## 5. Countries

**Production → Countries / regions** and **Closed testing → Countries / regions**: **Bangladesh**, plus the countries where your
students live (for example United Arab Emirates, Saudi Arabia, Qatar, Kuwait, Oman, Malaysia, United Kingdom, Italy, United States,
Canada), or all countries.

## 6. Closed test (needed before production)

1. **Testing → Closed testing → Create track** (or use *Alpha*) → **Testers** → **Create email list** called `MAWAH testers` with **at
   least 12 Gmail addresses** (staff, family, students; 15–20 is safer, since some forget). Save, and turn the list on.
2. **Create new release** → accept **Play App Signing** (Google keeps the app signing key; yours is the upload key) → **Upload** the
   `.aab` → Release name is filled in by itself (`1.0.0 (…)`) → Release notes:

   ```
   <bn-BD>
   প্রথম সংস্করণ: ভিডিও ক্লাস, ফ্রি ক্লাস, ফুডকস্টে রেসিপির খরচ ও ক্যালরি হিসাব, ইকুইপমেন্ট শপ, রাত ও দিনের লুক, আর নোটিফিকেশন।
   </bn-BD>
   <en-US>
   First release: video classes, free classes, FoodCost recipe costing with calories, the Equipment Shop, night and day looks, and notifications.
   </en-US>
   ```
3. **Next → Save → Send for review**. The first review takes from a few hours to a few days.
4. Copy the **Join on the web** link (Testers tab) and send it to every tester. Each one: opens the link signed in with *that* Gmail →
   **Become a tester** → installs from Google Play → opens the app now and then. They must stay opted in for **14 days in a row**.
5. New builds during the test: merge, wait for the Android app run, upload the new `.aab` to the same track. The version number grows
   by itself.

## 7. Apply for production (after the 14 days)

Dashboard → **Apply for production**. Google asks about the test. Answers you can adapt (say what really happened):

* *How did you recruit testers?* — `Our staff, their families and some of our students, invited by e-mail.`
* *How easy was it?* — choose what is true.
* *Engagement and feedback* — `Testers watched lessons, started the free classes, saved recipes in FoodCost and tried the shop and the
  day and night looks. They reported [what they said].`
* *Intended audience* — `Adults in Bangladesh and abroad who want to learn cooking and baking in Bangla, and home bakers who sell.`
* *How does the app give value?* — `Video classes they can follow at home, free classes, certificates, and a recipe costing tool that
  shows the cost, the selling price and the calories of each piece.`
* *Expected installs in the first year* — your honest estimate (for example 1,000–10,000).
* *What did you change after the test?* — the fixes you made (for example the keyboard no longer covers the password box, ingredients
  and calories in FoodCost, the day look).
* *How do you know it is ready?* — `All testers could sign in, watch lessons and save recipes; we fixed every problem they reported.`

When Google approves (up to about 7 days): **Production → Create new release → Add from library** (the tested build) → same notes →
**Review release → Start rollout to Production**.

## 8. The promo video (optional)

Google takes only a **YouTube link**. Upload `5-promo-video/mawah-academy-promo-bangla.mp4` to YouTube as **Public** or **Unlisted**
(never Private), with ads turned off, and paste its address into the Bangla listing's **Video** box; the English one into the English
listing.

## 9. Website texts to update (Admin → Settings → Policies)

Your own refund and terms texts (saved in Admin) still say kits and tools "cannot currently be ordered", while the Equipment Shop takes
orders. The texts below keep your rules (video courses are non-refundable; refunds in 7–10 working days) and point kits and tools to the
shop's return policy. Paste each into its box and press **Save**. One addition to check: a double charge, or a charge above the price
shown, is returned (remove that paragraph if you do not want it).

Lines you type in Admin now stay lines on the page (before, a heading typed on its own line ran into the next sentence).

### Refund — English
```
Effective date: 7 November 2026

## Video courses

MAWAH Academy video courses are digital content. Video-course purchases are non-refundable. Once access to a course video or other digital course content has been provided, the course order cannot be cancelled and the course fee will not be refunded.

If you were charged twice for the same order, or more than the price shown, tell us: the extra amount is returned.

## Kits and tools (Equipment Shop)

Kits and tools are sold in our [Equipment Shop](/en/shop). Their returns, replacements and refunds follow the [Shop return policy](/en/policies/shop-returns): tell us within 3 days of receiving the parcel if a product is damaged, wrong, missing or defective, with your order code and a photo or video. Each product page shows its price, and the checkout shows the delivery charge, before you order.

You can ask us to cancel a shop order before it is shipped. An order paid online that is cancelled is refunded in full.

## Refund processing time

Approved refunds are processed within 7–10 working days after we receive the complete claim and the information we need. When a product has to come back to us, this period starts when we receive it. The money goes back the way you paid (bKash, Nagad, card …); for cash on delivery, to your bKash, Nagad or Rocket number. A bank or payment service may take more time to credit it.

## Contact

For questions about a return, a refund or an order, use the contact details below or the [Contact](/en/contact) page.
```

### Refund — Bangla
```
কার্যকর তারিখ: ৭ নভেম্বর, ২০২৬

## ভিডিও কোর্স

MAWAH Academy-এর ভিডিও কোর্স ডিজিটাল কনটেন্ট। ভিডিও কোর্সের ক্রয় সম্পন্ন হলে কোর্স ফি রিফান্ডযোগ্য নয়। কোর্সের ভিডিও বা অন্যান্য ডিজিটাল কনটেন্টে প্রবেশাধিকার দেওয়ার পর কোর্স অর্ডার বাতিল বা কোর্স ফি ফেরত দেওয়া হবে না।

একই অর্ডারের জন্য দুবার টাকা কাটলে, অথবা দেখানো দামের চেয়ে বেশি কাটলে, আমাদের জানান: বাড়তি টাকাটা ফেরত দেওয়া হবে।

## কিট ও টুলস (ইকুইপমেন্ট শপ)

কিট ও টুলস বিক্রি হয় আমাদের [ইকুইপমেন্ট শপে](/shop)। এগুলোর রিটার্ন, বদল ও রিফান্ড চলে [শপের রিটার্ন নীতি](/policies/shop-returns) অনুযায়ী: পার্সেল পাওয়ার ৩ দিনের মধ্যে পণ্য ভাঙা, ভুল, কম বা ত্রুটিপূর্ণ হলে অর্ডার কোড আর একটি ছবি বা ভিডিওসহ আমাদের জানান। অর্ডারের আগে প্রতিটি পণ্যের পাতায় দাম, আর চেকআউটে ডেলিভারি চার্জ দেখানো থাকে।

পণ্য পাঠানোর আগে শপের অর্ডার বাতিল করতে বলতে পারেন। অনলাইনে টাকা দেওয়া অর্ডার বাতিল হলে পুরো টাকা ফেরত দেওয়া হয়।

## রিফান্ড প্রক্রিয়ার সময়

রিফান্ড অনুমোদিত হলে, সম্পূর্ণ দাবি ও প্রয়োজনীয় তথ্য পাওয়ার ৭–১০ কর্মদিবসের মধ্যে রিফান্ড প্রক্রিয়া করা হবে। পণ্য ফেরত পাঠাতে হলে, পণ্যটি আমাদের কাছে পৌঁছানোর দিন থেকে এই সময় গণনা করা হবে। টাকা ফেরত যায় যেভাবে পেমেন্ট করেছিলেন সেভাবেই (বিকাশ, নগদ, কার্ড …); ক্যাশ অন ডেলিভারির ক্ষেত্রে আপনার বিকাশ, নগদ বা রকেট নম্বরে। ব্যাংক বা পেমেন্ট সার্ভিসে টাকা জমা হতে আরও সময় লাগতে পারে।

## যোগাযোগ

রিটার্ন, রিফান্ড বা অর্ডার নিয়ে প্রশ্ন থাকলে নিচের যোগাযোগের তথ্য বা [যোগাযোগ](/contact) পাতা ব্যবহার করুন।
```

### Terms — English
```
Effective date: 7 November 2026

## Services

MAWAH Academy provides online cooking and baking video courses, on this website and in the MAWAH Academy app for Android, and sells kits and tools in its [Equipment Shop](/en/shop). The Equipment Shop's own terms are in the [Shop terms](/en/policies/shop-terms).

## Accounts and course use

Provide accurate information when creating an account and keep your sign-in details secure. Do not share your account or course access with another person. Purchased videos, recipes, lessons and other course materials are for your personal learning. You may not copy, republish, sell or distribute them without written permission from MAWAH Academy.

## The Android app

The app is free, and so are its free classes. Classes are bought on this website and open in the app with the same account. You can delete your account at any time: [Delete your account](/en/account/delete).

## Orders and payments

Review the price and payment instructions shown at checkout before placing an order. Online payments are completed on SSLCommerz or the relevant payment provider's own secure page. Do not enter card details or a wallet PIN on this website. For manual payments, an order may remain pending until the payment is verified. Equipment Shop orders can also be paid in cash on delivery, where it is offered.

## Refunds and products

Video-course purchases are non-refundable. Kits and tools can be returned or refunded under the [Shop return policy](/en/policies/shop-returns). See the [Return, refund and cancellation policy](/en/policies/refund) for details.

## Changes and contact

Course, content, price or service details may change; review the current details before ordering. For questions, use the contact details below or the [Contact](/en/contact) page.
```

### Terms — Bangla
```
কার্যকর তারিখ: ৭ নভেম্বর, ২০২৬

## সেবা

MAWAH Academy এই ওয়েবসাইটে এবং অ্যান্ড্রয়েডের মাওয়াহ একাডেমি অ্যাপে অনলাইনে রান্না ও বেকিংয়ের ভিডিও কোর্স প্রদান করে, আর [ইকুইপমেন্ট শপে](/shop) কিট ও টুলস বিক্রি করে। ইকুইপমেন্ট শপের নিজস্ব শর্ত [শপের শর্তাবলি](/policies/shop-terms) পাতায় দেওয়া আছে।

## অ্যাকাউন্ট ও কোর্স ব্যবহার

অ্যাকাউন্ট খোলার সময় সঠিক তথ্য দিন এবং আপনার লগইন তথ্য নিরাপদ রাখুন। আপনার অ্যাকাউন্ট বা কোর্সে প্রবেশাধিকার অন্যের সঙ্গে ভাগ করবেন না। কেনা ভিডিও, রেসিপি, পাঠ বা অন্যান্য কোর্স কনটেন্ট ব্যক্তিগত শেখার জন্য; MAWAH Academy-এর লিখিত অনুমতি ছাড়া এগুলো কপি, পুনঃপ্রকাশ, বিক্রি বা বিতরণ করা যাবে না।

## অ্যান্ড্রয়েড অ্যাপ

অ্যাপটি ফ্রি, এর ফ্রি ক্লাসগুলোও ফ্রি। ক্লাস কেনা হয় এই ওয়েবসাইটে, আর একই অ্যাকাউন্টে অ্যাপে খোলে। যেকোনো সময় অ্যাকাউন্ট ডিলিট করতে পারেন: [অ্যাকাউন্ট ডিলিট করুন](/account/delete)।

## অর্ডার ও পেমেন্ট

অর্ডারের সময় দেখানো মূল্য ও পেমেন্ট নির্দেশনা যাচাই করে অর্ডার দিন। অনলাইন পেমেন্ট SSLCommerz বা সংশ্লিষ্ট পেমেন্ট সেবার নিজস্ব নিরাপদ পেজে সম্পন্ন হয়। কার্ডের তথ্য বা PIN এই ওয়েবসাইটে দেবেন না। ম্যানুয়াল পেমেন্টের ক্ষেত্রে পেমেন্ট যাচাই না হওয়া পর্যন্ত অর্ডার অপেক্ষমাণ থাকতে পারে। ইকুইপমেন্ট শপের অর্ডারে, যেখানে সুযোগ আছে, ক্যাশ অন ডেলিভারিতেও টাকা দেওয়া যায়।

## রিফান্ড ও পণ্য

ভিডিও কোর্সের জন্য কোনো রিফান্ড দেওয়া হয় না। কিট ও টুলস [শপের রিটার্ন নীতি](/policies/shop-returns) অনুযায়ী ফেরত বা রিফান্ড করা যায়। বিস্তারিত জানতে [রিফান্ড ও বাতিল নীতি](/policies/refund) পড়ুন।

## পরিবর্তন ও যোগাযোগ

কোর্স, কনটেন্ট, মূল্য বা সেবার বিবরণ পরিবর্তিত হতে পারে; অর্ডারের আগে বর্তমান বিবরণ যাচাই করুন। কোনো প্রশ্ন থাকলে নিচের যোগাযোগের তথ্য বা [যোগাযোগ](/contact) পাতা ব্যবহার করুন।
```

## 10. Checklist

- [ ] PR merged; Android app run green; `.aab` downloaded (not `TEST-KEY`)
- [ ] Test account made (student ID + password copied)
- [ ] Refund and terms texts pasted in Admin (section 9)
- [ ] App created; store listing in Bangla and English; graphics uploaded
- [ ] App content: privacy policy, app access, ads, content rating, target audience, news, data safety, government, financial, health
- [ ] Trader status; countries
- [ ] Closed test: 12+ testers, release sent for review, join link shared
- [ ] Day 15 or later: Apply for production → then the production release
