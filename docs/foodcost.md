# FoodCost Pro — recipe costing, profit and (later) nutrition

FoodCost Pro is a tool inside MAWAH Academy. A baker enters a recipe: its ingredients and how much of each, how many pieces it makes, and
the packaging, labour and gas or electricity it takes. It shows what each piece costs, the price to ask for the profit wanted, and the real
profit at the price it is sold for.

It uses the same login, server and database as the website, and is built for **the website and the Android app together**. It has its own
calculation code, tables and API, so it can later become a separate app without being rebuilt.

## The owner's three decisions (6 November 2026)

| Question | Decision | What it means for the build |
|---|---|---|
| Who keeps ingredient prices up to date? | **Both.** The owner sets the current average Dhaka market price of each ingredient in Admin, as the default. Any user can type their own purchase price instead, and it is kept in their account. | Shared ingredient list with a default price (Admin), plus a price per user that replaces it for that user only. The price history is kept, so old reports stay correct. |
| Website first, or website and app together? | **Together.** The point is a stronger Play Store app; both use the same server and the same calculation engine. | The calculation engine is shared code, used by the website, the app and the server. The screens are built for both in the same phase. |
| Free or paid? | **Free at first.** Up to **3 saved recipes** free; **MAWAH students unlimited**. A Free/Pro plan is kept in the database so a paid plan can start at any time. | Google Play's reviewers can sign in and use the whole tool. The app never shows a price or a buy button (Google Play rules). |

## Phases

| Phase | What | Status |
|---|---|---|
| **1a** | The calculation engine (`shared/src/foodcost.ts`) and its tests, and this plan | built |
| **1b** | Database tables (migration `0025`), the API (`/api/fc/v1`), Admin → FoodCost (ingredients and default prices, a pasted list, the users and their plan), plans and limits, account deletion | built |
| **1c + 1d** | The screens, on the website (`/app/foodcost`) and in the Android app, each with a **FoodCost** tab, in Bangla and English: my recipes with the plan; the recipe editor, costing live while one types (the same engine as the server, `fcCostWith`) with the cost and price kept in sight on a phone; ingredients & prices (the Dhaka average or one's own price, one's own ingredients) | built |
| 1e | The report: print / save as PDF on the website, share as PDF from the app | next |
| **2** | Nutrition: calories, protein, carbohydrate, fat, sugar, fibre and sodium for each line, one piece, 100 g and the batch, beside the cost (`nutritionOf`, the same engine); a starter list of 45 common baking ingredients with their figures (migration `0027`) | built |
| 3 | Other currencies in use (USD, GBP, EUR, AED), teams, a paid plan, a separate app | later |

## How the calculation works (phase 1a)

The engine is plain TypeScript with no database or screen in it, so the same numbers come out on the website, in the app and in a report.

- **Units.** Weight: mg, g, kg, lb, oz. Volume: ml, l, teaspoon (5 ml), tablespoon (15 ml), cup (240 ml). Count: piece, dozen. Everything
  is turned into grams, millilitres or pieces first.
- **Weight ↔ volume, pieces ↔ weight.** Only through the ingredient's own density (grams in one ml, e.g. flour ≈ 0.53) or the weight of one
  piece (an egg ≈ 50 g). If an ingredient has neither, the line is shown as a problem. The engine never guesses.
- **Prices are per pack:** "৳120 for 1 kg", "৳150 for 1 dozen", "৳550 for 500 g". The engine shares the pack price out over the amount
  used, in any unit the ingredient can be measured in.
- **Money is kept in paisa** (whole numbers) with a currency code. Each line is rounded to the paisa, and the totals are the sums of the
  rounded lines, so what is shown always adds up.
- **Costs that are not ingredients:**
  - **per batch:** gas, cleaning;
  - **per piece:** a box, a sticker;
  - **per hour:** labour or the oven, as rate × hours.
  - A per-piece cost needs a yield counted in pieces.
- **Cost of one piece** = the batch total ÷ the yield. The yield can be 12 pieces, 1 cake, or 800 g of buttercream.
- **Markup and margin are different, and both are offered.** On a cost of ৳100:
  - a **25% markup** is ৳125;
  - a **25% margin** is ৳133.34.
  - The suggested price is **rounded up** to a step (to the paisa, or ৳1, ৳5, ৳10), never down, so it never falls below the profit asked for.
- **The real profit at your price:** profit per piece and per batch, and the real margin and markup. A loss is shown below zero, not hidden.
- **Recipes inside recipes.** A cake can use a buttercream recipe. The buttercream's whole batch cost (ingredients, its own labour and gas)
  is shared out by how much of it is used: by its weight, or by its pieces. A recipe that ends up using itself is stopped and reported.
  Recipes can go at most six deep.
- **Problems are listed, not guessed.** The problems the engine reports:
  - no price yet;
  - weight against volume with no density;
  - an unknown ingredient;
  - a recipe that uses itself;
  - a yield of nothing;
  - a margin of 100% or more.

  `complete` says whether the total is the whole cost or only part of it. A problem with the price only, such as an impossible margin,
  leaves the cost whole.

`worker/test/foodcost-engine.test.ts` checks all of this with figures worked out by hand. It has 16 tests, for example 12 vanilla cupcakes:
৳490 of ingredients, ৳10 a box each, 2 hours at ৳100, ৳50 of gas and ৳30 more come to ৳890 a batch, so ৳74.17 a piece.

## Nutrition (phase 2) and the starter list

**What is counted.** Each ingredient has its figures per 100 g: calories (kcal), protein, carbohydrate, fat, sugar (part of the carbohydrate)
and fibre in grams, sodium in mg (the `fc_ingredients` columns `kcal` … `sodium_mg`).

- **Each line** is weighed in grams, through the same units as the cost: a cup of flour through its density, eggs through the weight of one.
  Its figures are the ingredient's per 100 g × the grams ÷ 100.
- **The batch** is the sum of the lines. **One piece** is the batch ÷ the yield, when the yield is counted (12 cupcakes). **100 g** is the
  batch ÷ its weight: a yield by weight (800 g of buttercream), or the finished weight of a counted one. Without a finished weight there is
  no "per 100 g": the engine does not guess the weight lost in the oven.
- **A recipe inside a recipe** passes on its share of the figures, shared out exactly as its cost is (by weight, or by its own pieces).
- **Rounding:** calories and sodium to the whole number, grams to one decimal; one piece and 100 g are worked out from the batch before it is
  rounded.
- **Never a guess:** an ingredient with no calorie figure ("no figures"), or one measured in a way it cannot be weighed (a cup of something
  with no density: "no weight"), is reported and left out, and the total says it is only part of it. A figure one ingredient lacks (the
  table gives none) marks only that nutrient's total as partial (a star on the screens).
- **The figures are a guide, not a laboratory test**, and the screens say so. FoodCost stores nothing about anyone's body or eating, only a
  recipe's figures. This is not a calorie tracker (which would be health data, with extra Google Play rules).

**The starter list** (migration `0027_foodcost_starter.sql`): 45 common baking ingredients in 9 groups (flour, sugar, dairy and eggs, fats,
baking aids, chocolate, nuts and dried fruit, fruit, spices), each with its Bangla and English name, its density or piece weight from USDA's
cup and teaspoon weights, and its figures per 100 g from **USDA FoodData Central (SR Legacy, public domain)**; empty where the table gives
none (semolina's sugar, yeast's sugar, shortening's sodium). A name already on the shared list is left as it is, so the owner's own entries
win and the list never adds a name twice. Staff can correct any figure in Admin → FoodCost, and a user can give their own ingredients
figures from the pack's label.

**The starter prices** (migration `0028_foodcost_prices.sql`, 7 November 2026): each of the 45 has a Dhaka default price, so a recipe is
costed at once. Where each comes from is written on the price itself (its "where" line) and in the migration's header:

- the **Dhaka market price report** (TBS, late October 2026) for the staples: flour, atta, sugar, eggs, milk, soybean oil, salt;
- **Chaldal**'s listing for the rest (a brand's pack). A few of those are premium brands and may be above the market: oats (Quaker),
  dalda (Aseel), dark chocolate (Lindt), walnuts, cream cheese. The owner's guide asks the owner to check them once.
- A ripe banana is counted at 100 g a piece (`g_per_piece`), so a dozen's price works by weight; lemon juice is priced by the ml.

The migration only adds a default price where an ingredient has none: a price the owner has set (or set since) is never overwritten, and
running it again changes nothing (`worker/test/foodcost-api.test.ts`). Prices are history: the owner's newer price counts, the old stays.

## Easier costing: the price on the line

Each ingredient line of a recipe (website and app) says the price it is costed at: "Price: ৳170 for 2 kg · Dhaka average" (or "· My
price"). With no price yet the line says so and offers **Set price** right there: pack size, unit and price, saved as the user's own price
(`PUT /api/fc/v1/prices/:id`, the same as on Ingredients & prices), and the recipe is costed at it at once. The pack starts in the kind of
unit the line uses (kg for a line in grams, litre for millilitres, piece for pieces), so a new price always fits its line. The recipe is
one form, so the box is not a form of its own: Enter in it saves the price, not the recipe. The red "no price" message on the line is
gone (the price box says it); the result still lists every missing price.

## The PDF of the result

**Download PDF** under the result (website and app) makes a one-page A4 report of the recipe as it is on the screen, saved or not: the
name, what it makes and the date; the cost of one, the price and the calories of one; each ingredient with its amount, cost, share and
calories; the batch, the price and the profit; where the cost goes; the nutrients; and notes (what is missing, where the numbers come from).
One page design for both (`shared/src/foodcostReport.ts`), every word in the reader's language, every user's word escaped.

- **Website:** the browser's own Save as PDF, like the certificate. The page itself is printed with a print style that shows only the report
  (a phone's browser may print the whole page from a hidden frame, so no frame is used). The site's security rules allow no inline style,
  so this one style is allowed by its fingerprint (`worker/src/routes/spa.ts`, `style-src 'self' 'sha256-…'`). The report goes as soon as
  the recipe changes, so printing the page later prints the page. The paper is white even in the site's night look.
- **App:** `expo-print` turns the same page into a PDF file (A4) in the app's own cache folder (no storage permission), named after the
  recipe, and the share sheet opens: Files, Drive, WhatsApp, e-mail. The app's PDF names no website (Google Play; `mobile/src/strings.test.ts`).

**Where it shows:** the recipe editor (website and app) shows each line's calories next to its cost, a **Calories & nutrition** panel beside
the cost, and the calories of one piece in the bar at the bottom of a phone; the recipe list shows the calories of one piece when every
line has its figure (`kcal_per_unit`); the ingredient lists show the calories per 100 g.

## The database (phase 1b, migration `0025_foodcost.sql`)

All tables start with `fc_`. Every recipe belongs to a **workspace**: each user gets a personal one, and a bakery team can share one later
with no database change.

| Table | What it keeps |
|---|---|
| `fc_workspaces` | owner (student account), name, **plan** (`free` · `pro`), plan end date and how it was given (admin / website / Google Play), currency |
| `fc_ingredients` | name in Bangla and English, category, density (g/ml), weight of one piece, its nutrition per 100 g (`kcal`, `protein_g`, `carbs_g`, `fat_g`, `sugar_g`, `fiber_g`, `sodium_mg`; NULL = not known); `workspace_id` empty = the shared list kept in Admin, set = a user's own ingredient |
| `fc_prices` | the price of a pack (amount, unit, paisa, currency), supplier and date. One row per change, so there is a history. Rows with no workspace are the **Admin default** (Dhaka average); a workspace's newest row **replaces the default for that user only**. |
| `fc_recipes` | workspace, name, notes, yield (amount and unit, a label such as "slice"), the batch's finished weight, the extra costs and the pricing choice, timestamps, soft delete |
| `fc_recipe_items` | the lines: an ingredient or another recipe, the amount and the unit, in order |

## The API (phase 1b) — `/api/fc/v1`, for a signed-in student (website cookie or the app's token)

- `GET /me`: plan, limit, how many recipes are saved, and whether the user counts as a MAWAH student.
- `GET /book`: everything the screens cost with while one types: the plan, every ingredient with the price that counts, every recipe in full.
- `GET /prices/:ingredient`: your own price history for an ingredient, with the current Admin default.
- `GET /ingredients`: the shared list plus the user's own, each with the price that applies to this user (theirs, else the default), and its
  `nutrition` per 100 g (null without a calorie figure).
- `POST /ingredients`: add your own ingredient, with its `nutrition` if known (figures need the calories; each is checked against what 100 g
  can hold). `PUT /ingredients/:id` without `nutrition` leaves the figures as they are (an older app sends none); `nutrition: null` removes
  them.
- `PUT /prices/:ingredient`: set your own price. `DELETE /prices/:ingredient`: go back to the Admin default.
- `GET /recipes`, `POST /recipes`, `GET /recipes/:id`, `PUT /recipes/:id`, `DELETE /recipes/:id`, `POST /recipes/:id/duplicate`. The list carries
  `kcal_per_unit` (the calories of one piece, when every line has its figure).
- The server costs a saved recipe with the same engine and returns the results. The screens also run the engine while you type, so the
  numbers change at once.
- **Admin** (`/api/admin/fc/...`):
  - `ingredients`: the shared list, with `POST`, `PUT /:id`, `POST /:id/price` (a new default) and `GET /:id/prices` (the history);
  - `ingredients/import`: a pasted list, up to 200 rows a request (the screen sends a longer one in parts). A name already on the list
    (Bangla or English) is updated, a name twice in the list is one ingredient, and a price the same as the newest default is not saved
    again, so pasting the same sheet each month keeps only real changes in the history;
  - `workspaces`: the users and their plan, with `PUT /:id/plan` to give Pro.
  - Permissions: `fc:read` (everyone), `fc:write` (owner and Content Manager), `fc:plans` (owner only).

## Plans, limits and Google Play

- **Free:** 3 saved recipes. Duplicating counts as saving. Deleting a recipe frees its place. The check and the save are one database statement, so two saves at the same moment cannot both pass the limit.
- **MAWAH student:** no limit. A student is an account with an active (not revoked) enrolment in a **website** class, which includes classes
  added by staff or imported. Free Android-app classes do not count, otherwise anyone could unlock it by joining a free class.
- **Pro:** no limit. Today only Admin can give it. A paid Pro is a later decision.
- **Safety stops** for everyone, so nobody can fill the database: 2,000 recipes a workspace ("no limit" still stops there, far more than a
  bakery keeps), 300 own ingredients, and the newest 50 changes of one's own price for an ingredient (the oldest go).
- **In the app, never a price or a buy button** (`mobile/src/strings.test.ts` checks this). At the limit, the app says only: "Free accounts
  keep 3 recipes. Delete one to save a new one." It does not point to the website or to buying a class, because Google Play does not allow
  leading users to pay outside the app for something used in the app. The website may say that MAWAH students have no limit.
- **If Pro is ever sold:**
  - In the Android app, it must go through Google Play Billing, which takes 15% of a subscription.
  - On the website only, it can go through SSLCommerz, the same way classes are sold.
- **Google Play's reviewers** use the test account from Admin → Android app. 3 recipes are enough to try every screen.

## Privacy

- FoodCost keeps only what the user types: recipes, their own prices and ingredients.
- Deleting the account (website, app or Admin) also deletes the workspace and all of this (`services/accountDeletion.ts`).
- The privacy policy and Google Play's Data safety form will say so before the screens go live.
- A daily calorie tracker (phase 2+) would count as health data, which has extra Google Play rules. It is not planned for phase 1.

## What is needed from the owner

1. **Check the Dhaka default prices** (in since 7 November 2026, sources above): change any that differ from what your students pay, in
   Admin → FoodCost → Ingredients. An ingredient with no price shows "no price yet", and the site never shows a made-up price.
2. **Confirm the cup and spoons:** cup 240 ml, tablespoon 15 ml, teaspoon 5 ml.
3. **5 real recipes whose cost you already know**, to check the engine against your own numbers.
4. **Usual rates:** labour per hour, and gas or electricity per hour or per batch, to offer as starting values.

---

## বাংলা সারাংশ

- FoodCost Pro ওয়েবসাইট ও অ্যান্ড্রয়েড অ্যাপে একসাথে আসবে। লগইন, সার্ভার আর ডাটাবেস একই থাকবে, আর হিসাবের কোড একটাই, যা দুই জায়গাতেই চলে।
- **দাম:** অ্যাডমিন প্যানেলে ঢাকার গড় বাজারদর ডিফল্ট হিসেবে থাকবে। যেকোনো ইউজার নিজের কেনা দাম বসাতে পারবেন। সেটা শুধু তার অ্যাকাউন্টে সেভ হবে, আর দামের ইতিহাসও থাকবে।
- **প্ল্যান:**
  - শুরুতে সবার জন্য ফ্রি, ৩টি রেসিপি পর্যন্ত সেভ করা যাবে।
  - MAWAH-এর স্টুডেন্টদের (ওয়েবসাইটের ক্লাসে ভর্তি) জন্য আনলিমিটেড।
  - ডাটাবেসে Free/Pro রাখা আছে, যেন পরে পেইড প্ল্যান চালু করা যায়।
  - অ্যাপে কখনো দাম বা কেনার বোতাম থাকবে না (গুগল প্লের নিয়ম)।
- **এই পুল রিকোয়েস্টে (১ক):** হিসাবের ইঞ্জিন আর তার ১৬টি টেস্ট। ইঞ্জিন যা করে:
  - একক বদল (গ্রাম, কেজি, কাপ, চামচ, পিস, ডজন);
  - প্যাকের দাম থেকে ব্যবহৃত অংশের খরচ;
  - প্যাকেজিং, শ্রম, গ্যাস/বিদ্যুৎ;
  - প্রতি পিসের খরচ;
  - মার্কআপ ও মার্জিন (দুটো আলাদা);
  - প্রস্তাবিত দাম (উপরের দিকে গোল করা);
  - আসল লাভ;
  - রেসিপির ভেতরে রেসিপি।

  কোনো সংখ্যা নিশ্চিত না হলে ইঞ্জিন অনুমান করে না, সমস্যা হিসেবে দেখায়।
- **পরের ধাপ:**
  - ১খ: ডাটাবেস, API, অ্যাডমিনে উপকরণ ও ডিফল্ট দাম।
  - ১গ+১ঘ: ওয়েবসাইট ও অ্যাপের স্ক্রিন একসাথে।
- **দাম (৭ নভেম্বর ২০২৬):** শুরুর ৪৫টি উপকরণে ঢাকার দাম বসানো আছে (ঢাকার বাজারদরের প্রতিবেদন আর Chaldal থেকে), তাই রেসিপির খরচ সাথে সাথে আসে। আপনার বসানো দাম কখনো বদলায় না।
- **লাইনেই দাম:** রেসিপির প্রতিটি লাইনের নিচে কোন দামে হিসাব হচ্ছে লেখা থাকে। দাম না থাকলে সেখানেই **দাম দিন**।
- **PDF:** ফলের নিচে **PDF ডাউনলোড**। ওয়েবসাইটে প্রিন্টের জানালায় Save as PDF; অ্যাপে PDF তৈরি হয়ে শেয়ারের তালিকা খোলে।
- **আপনার কাছ থেকে লাগবে:**
  - শুরুর দামগুলো একবার মিলিয়ে দেখা (অ্যাডমিন → ফুডকস্ট → উপকরণ), বিশেষ করে ওটস, ডালডা, ডার্ক চকলেট, আখরোট, ক্রিম চিজ;
  - কাপ ও চামচের মাপ নিশ্চিত করা (কাপ ২৪০ মিলি, টেবিল চামচ ১৫ মিলি, চা চামচ ৫ মিলি);
  - খরচ জানা আছে এমন ৫টি আসল রেসিপি;
  - শ্রম ও গ্যাস/বিদ্যুতের স্বাভাবিক রেট।
