#!/usr/bin/env node
/**
 * Generates worker/migrations/0002_seed_catalog.sql — the MAWAH Academy launch catalog.
 *
 * Source of truth for the 26 launch classes: names, BDT prices and the Facebook post that holds each
 * class's full menu/details (as supplied by the business owner). Descriptions are intentionally
 * generic and derived from the class title only — the owner replaces them with real copy in
 * Admin → Courses. No ratings, student counts or testimonials are seeded (honesty guardrail).
 *
 *   node scripts/gen-seed-catalog.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FB = "https://www.facebook.com/share/p/";

export const categories = [
  { slug: "snacks-fastfood", bn: "স্ন্যাক্স ও ফাস্টফুড", en: "Snacks & Fast Food", accent: "snack", icon: "snack",
    blurbBn: "স্ন্যাক্স, ফাস্টফুড, পাফ প্যাস্ট্রি ও ইফতারের জনপ্রিয় আইটেম",
    blurbEn: "Snacks, fast food, puff pastry and iftar favourites" },
  { slug: "cakes-bakery", bn: "কেক ও বেকারি", en: "Cakes & Bakery", accent: "cake", icon: "cake",
    blurbBn: "কেক, মাফিন, ব্রাউনি ও বেকিংয়ের ক্লাস",
    blurbEn: "Cakes, muffins, brownies and baking classes" },
  { slug: "desserts-drinks", bn: "ডেজার্ট ও পানীয়", en: "Desserts & Drinks", accent: "dessert", icon: "glass",
    blurbBn: "ডেজার্ট, শরবত ও মৌসুমি বিশেষ আইটেম",
    blurbEn: "Desserts, sharbat and seasonal specials" },
  { slug: "cooking-biryani", bn: "রান্না ও বিরিয়ানি", en: "Cooking & Biryani", accent: "cook", icon: "bowl",
    blurbBn: "বিগিনার কুকিং, তেহারি ও বিরিয়ানির ক্লাস",
    blurbEn: "Beginner cooking, tehari and biryani classes" },
  { slug: "mishti-halua", bn: "মিষ্টি ও হালুয়া", en: "Sweets & Halua", accent: "sweet", icon: "sweet",
    blurbBn: "রসগোল্লা, মিষ্টি, হালুয়া ও বরফির ক্লাস",
    blurbEn: "Rasgulla, mishti, halua and borfi classes" },
  { slug: "frozen-business", bn: "ফ্রোজেন ফুড ও বিজনেস", en: "Frozen Food & Business", accent: "frozen", icon: "snowflake",
    blurbBn: "ফ্রোজেন ফুড ও হোমফুড বিজনেসের ক্লাস",
    blurbEn: "Frozen food and home-food business classes" },
];

// [slug, cat, titleBn, titleEn, shortBn, shortEn, price, fbPostId, level, featured]
export const courses = [
  ["sweet-savory-fast-food-class-season-1", "snacks-fastfood", "সুইট এন্ড স্যাভরি ফাস্টফুড ক্লাস সিজন ১", "Sweet & Savory Fast Food Class — Season 1",
    "মিষ্টি ও নোনতা ফাস্টফুড আইটেম ধাপে ধাপে শেখার অনলাইন ক্লাস — সিজন ১।", "Learn sweet and savory fast food items step by step in this online class — Season 1.", 1850, "1CphvX74JK", null, 1],
  ["sweet-savory-fast-food-class-season-2", "snacks-fastfood", "সুইট এন্ড স্যাভরি ফাস্টফুড ক্লাস সিজন ২", "Sweet & Savory Fast Food Class — Season 2",
    "মিষ্টি ও নোনতা ফাস্টফুড আইটেম ধাপে ধাপে শেখার অনলাইন ক্লাস — সিজন ২।", "Learn sweet and savory fast food items step by step in this online class — Season 2.", 1550, "1V5j7ri4Ai", null, 0],
  ["puff-pastry-special-class", "snacks-fastfood", "পাফ প্যাস্ট্রি স্পেশাল ক্লাস", "Puff Pastry Special Class",
    "পাফ প্যাস্ট্রি তৈরির বিশেষ অনলাইন ক্লাস।", "A special online class on making puff pastry.", 1150, "1GV8cmTpkM", null, 0],
  ["shahi-iftar-class", "snacks-fastfood", "শাহী ইফতার ক্লাস", "Shahi Iftar Class",
    "শাহী ইফতারের আইটেম নিয়ে বিশেষ অনলাইন ক্লাস।", "A special online class on royal-style (shahi) iftar items.", 2550, "1Dh43hJ769", null, 0],

  ["premium-signature-cake-master-class-season-1", "cakes-bakery", "প্রিমিয়াম সিগনেচার কেক মাস্টার ক্লাস সিজন ১", "Premium Signature Cake Master Class — Season 1",
    "প্রিমিয়াম সিগনেচার কেক তৈরির মাস্টার ক্লাস — সিজন ১।", "A premium signature cake master class — Season 1.", 1550, "18MeH12RGx", null, 1],
  ["premium-signature-cake-master-class-season-2", "cakes-bakery", "প্রিমিয়াম সিগ্নেচার কেক মাস্টারক্লাস সিজন ২", "Premium Signature Cake Master Class — Season 2",
    "প্রিমিয়াম সিগনেচার কেক তৈরির মাস্টার ক্লাস — সিজন ২।", "A premium signature cake master class — Season 2.", 1550, "185jcewLGE", null, 0],
  ["ultimate-triple-chocolate-matilda-cake-class", "cakes-bakery", "আল্টিমেট ট্রিপল চকলেট মাটিলডা কেক ক্লাস", "Ultimate Triple Chocolate Matilda Cake Class",
    "ট্রিপল চকলেট মাটিলডা কেক তৈরি শেখার ক্লাস।", "Learn to make the ultimate triple chocolate Matilda cake.", 850, "1ChWCKN2bD", null, 0],
  ["london-cake-dark-chocolate-salted-caramel-brigadeiro-cake", "cakes-bakery", "লন্ডন কেক/ডার্ক চকলেট সল্টেড ক্যারামেল ব্রিগাডেইরো কেক", "London Cake / Dark Chocolate Salted Caramel Brigadeiro Cake",
    "লন্ডন কেক এবং ডার্ক চকলেট সল্টেড ক্যারামেল ব্রিগাডেইরো কেকের ক্লাস।", "A class on London cake and dark chocolate salted caramel brigadeiro cake.", 850, "19sE17YPDV", null, 0],
  ["muffin-special-class", "cakes-bakery", "মাফিন স্পেশাল ক্লাস", "Muffin Special Class",
    "মাফিন তৈরির বিশেষ অনলাইন ক্লাস।", "A special online class on making muffins.", 1050, "19Wy2e3wRp", null, 0],

  ["beginners-baking-class", "cakes-bakery", "বিগিনার্স বেকিং ক্লাস", "Beginners Baking Class",
    "একদম নতুনদের জন্য সাজানো ধাপে ধাপে বেকিং শেখার ক্লাস।", "A step-by-step baking class arranged for complete beginners.", 400, "1LXTR4KSUU", "beginner", 1],
  ["beginners-basic-cooking-and-dessert-class", "cooking-biryani", "বিগিনার্স বেসিক কুকিং এন্ড ডেজার্ট ক্লাস", "Beginners Basic Cooking & Dessert Class",
    "একদম নতুনদের জন্য সাজানো বেসিক কুকিং ও ডেজার্টের ক্লাস।", "A basic cooking and dessert class arranged for complete beginners.", 1050, "18HgxGV7Re", "beginner", 1],

  ["exclusive-brownie-master-class", "cakes-bakery", "এক্সক্লুসিভ ব্রাউনি মাস্টার ক্লাস", "Exclusive Brownie Master Class",
    "ব্রাউনি তৈরির এক্সক্লুসিভ মাস্টার ক্লাস।", "An exclusive master class on brownies.", 1850, "1DRk8Xv2BP", null, 1],
  ["exclusive-short-glass-dessert-class", "desserts-drinks", "এক্সক্লুসিভ শর্ট গ্লাস ডেজার্ট ক্লাস", "Exclusive Short Glass Dessert Class",
    "শর্ট গ্লাস ডেজার্ট তৈরির এক্সক্লুসিভ ক্লাস।", "An exclusive class on short glass desserts.", 2550, "1ZvxWgVUax", null, 0],
  ["mango-season-special-class", "desserts-drinks", "ম্যাংগো সিজন স্পেশাল ক্লাস", "Mango Season Special Class",
    "আমের মৌসুমের বিশেষ আইটেম নিয়ে স্পেশাল ক্লাস।", "A special class on mango-season specials.", 2050, "1bQAgkEsKw", null, 1],
  ["saffron-pistachio-sharbat-and-mahalabia-class", "desserts-drinks", "জাফরানি পেস্তা শরবত ও মাহলাবিয়া ক্লাস", "Saffron Pistachio Sharbat & Mahalabia Class",
    "জাফরানি পেস্তা শরবত ও মাহলাবিয়া তৈরির ক্লাস।", "A class on saffron pistachio sharbat and mahalabia.", 610, "1CXkcuCzGm", null, 0],
  ["tehari-and-dessert-bowl-class", "cooking-biryani", "তেহারি ও ডেজার্ট বোল ক্লাস", "Tehari & Dessert Bowl Class",
    "তেহারি ও ডেজার্ট বোল তৈরির ক্লাস।", "A class on tehari and dessert bowls.", 650, "18wWk6mMDF", null, 0],
  ["traditional-aurosh-biryani-online-class", "cooking-biryani", "ঐতিহ্যবাহী ঔরশ বিরিয়ানি অনলাইন ক্লাস", "Traditional Aurosh Biryani Online Class",
    "ঐতিহ্যবাহী ঔরশ বিরিয়ানি শেখার অনলাইন ক্লাস।", "An online class on traditional Aurosh biryani.", 350, "1JUeE66obm", null, 1],

  ["rasgulla-special-class", "mishti-halua", "রসগোল্লা স্পেশাল ক্লাস", "Rasgulla Special Class",
    "রসগোল্লা তৈরির বিশেষ ক্লাস।", "A special class on making rasgulla.", 750, "17SvYa5aKo", null, 0],
  ["advanced-mishti-class", "mishti-halua", "এডভান্স মিষ্টি ক্লাস", "Advanced Mishti Class",
    "এডভান্স লেভেলের মিষ্টি তৈরির ক্লাস।", "An advanced-level class on making mishti (Bengali sweets).", 1250, "18RSKSMgai", null, 0],
  ["exclusive-mishti-short-class", "mishti-halua", "এক্সক্লুসিভ মিষ্টি শর্ট ক্লাস", "Exclusive Mishti Short Class",
    "মিষ্টি তৈরির এক্সক্লুসিভ শর্ট ক্লাস।", "An exclusive short class on making mishti (Bengali sweets).", 550, "14kPc7wgVEh", null, 0],
  ["kalojam-aflatun-mishti-special-class", "mishti-halua", "কালোজাম, আফলাতুন মিষ্টি স্পেশাল ক্লাস", "Kalojam & Aflatun Mishti Special Class",
    "কালোজাম ও আফলাতুন মিষ্টির স্পেশাল ক্লাস।", "A special class on kalojam and aflatun sweets.", 850, "1B2vRkWDRt", null, 0],
  ["sugar-free-mishti-class", "mishti-halua", "সুগার ফ্রি মিষ্টি ক্লাস", "Sugar-Free Mishti Class",
    "সুগার ফ্রি মিষ্টি তৈরির ক্লাস।", "A class on making sugar-free mishti.", 1250, "1BmjjHcXP2", null, 0],
  ["best-halua-borfi-class", "mishti-halua", "বেস্ট হালুয়া বরফি ক্লাস", "Best Halua & Borfi Class",
    "হালুয়া ও বরফি তৈরির ক্লাস।", "A class on making halua and borfi.", 1550, "1DERxSnpSr", null, 0],
  ["premium-mishti-master-class", "mishti-halua", "প্রিমিয়াম মিষ্টি মাস্টার ক্লাস", "Premium Mishti Master Class",
    "প্রিমিয়াম মিষ্টি তৈরির মাস্টার ক্লাস।", "A premium master class on making mishti.", 3550, "1DrGD8Wbp5", null, 1],

  ["frozen-food-business-master-class", "frozen-business", "ফ্রোজেন ফুড বিজনেস মাস্টার ক্লাস", "Frozen Food Business Master Class",
    "যারা ফ্রোজেন ফুডকে বিজনেস হিসেবে নিতে চান তাদের জন্য মাস্টার ক্লাস।", "A master class for those who want to take frozen food as a business.", 3500, "1B1vdmDuoH", null, 1],
  ["kids-tiffin-special-frozen-food-class", "frozen-business", "কিডস টিফিন স্পেশাল ফ্রোজেনফুড ক্লাস (হোমফুড স্পেশাল)", "Kids Tiffin Special Frozen Food Class (Homefood Special)",
    "কিডস টিফিনের জন্য ফ্রোজেন ফুড আইটেম — হোমফুড স্পেশাল ক্লাস।", "Frozen food items for kids tiffin — a homefood special class.", 1150, "1PWtH69E76", null, 0],
];

// optional per-class icon shown on the generated banner (falls back to the category icon)
export const iconBySlug = {
  "puff-pastry-special-class": "pastry",
  "shahi-iftar-class": "crescent",
  "muffin-special-class": "cupcake",
  "beginners-baking-class": "cupcake",
  "exclusive-brownie-master-class": "brownie",
  "mango-season-special-class": "mango",
  "traditional-aurosh-biryani-online-class": "pot",
  "kids-tiffin-special-frozen-food-class": "tiffin",
  "tehari-and-dessert-bowl-class": "pot",
};

const LONG_BN = "এই ক্লাসের পূর্ণ বিবরণ, মেন্যু ও রেসিপির তালিকা আমাদের ফেসবুক পোস্টে দেওয়া আছে।";
const LONG_EN = "The full class details, menu and recipe list are on our Facebook post.";

const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
for (const c of courses) {
  for (const f of [c[2], c[3], c[4], c[5]]) if (f.includes(";")) throw new Error("semicolon in seed text: " + f);
}

let sql = `-- =============================================================================
--  MAWAH Academy — launch catalog seed (GENERATED by scripts/gen-seed-catalog.mjs — edit that file)
--  26 classes with the owner-supplied BDT prices and Facebook details links.
-- =============================================================================

`;

sql += "-- categories\n";
categories.forEach((c, i) => {
  sql += `INSERT INTO categories (slug, name_bn, name_en, blurb_bn, blurb_en, accent, icon, sort) VALUES (${q(c.slug)}, ${q(c.bn)}, ${q(c.en)}, ${q(c.blurbBn)}, ${q(c.blurbEn)}, ${q(c.accent)}, ${q(c.icon)}, ${(i + 1) * 10});\n`;
});

sql += `
-- default instructor (placeholder profile — the owner edits this in Admin → Instructors)
INSERT INTO instructors (slug, name_bn, name_en, headline_bn, headline_en, bio_bn, bio_en, sort) VALUES ('mawah-academy-team', 'মাওয়াহ একাডেমি টিম', 'MAWAH Academy Team', 'রান্না ও বেকিংয়ের অনলাইন ক্লাস', 'Online cooking and baking classes', 'মাওয়াহ একাডেমির সকল ক্লাস পরিচালনা করে মাওয়াহ একাডেমি টিম।', 'All MAWAH Academy classes are run by the MAWAH Academy team.', 10);

-- courses
`;

courses.forEach((c, i) => {
  const [slug, cat, tBn, tEn, sBn, sEn, price, fb, level, featured] = c;
  sql +=
    `INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, long_bn, long_en, icon, category_id, instructor_id, level, price, status, details_url, featured, sort, published_at) VALUES (` +
    `${q(slug)}, ${q(tBn)}, ${q(tEn)}, ${q(sBn)}, ${q(sEn)}, ${q(LONG_BN)}, ${q(LONG_EN)}, ${q(iconBySlug[slug] ?? null)}, ` +
    `(SELECT id FROM categories WHERE slug = ${q(cat)}), 1, ${q(level)}, ${price}, 'published', ${q(FB + fb + "/")}, ${featured}, ${(i + 1) * 10}, strftime('%Y-%m-%dT%H:%M:%SZ','now'));\n`;
});

const setting = (key, value) =>
  `INSERT INTO settings (key, value) VALUES (${q(key)}, ${q(JSON.stringify(value))});\n`;

sql += "\n-- site settings (all editable in Admin → Settings)\n";
sql += setting("contact", { whatsapp: "", phone: "", email: "", facebook: "", youtube: "", instagram: "" });
sql += setting("announcement", { bn: "", en: "" });
sql += setting("payments", {
  sslcommerz: true,
  bkash_direct: false,
  manual: true,
  manual_numbers: { bkash: "", nagad: "", rocket: "" },
  manual_note_bn: "টাকা পাঠিয়ে ট্রানজেকশন আইডি (TrxID) এবং যে নম্বর থেকে পাঠিয়েছেন সেটি জমা দিন। যাচাই শেষে আপনার ক্লাস চালু হবে।",
  manual_note_en: "Send the amount, then submit the transaction ID (TrxID) and the number you paid from. Your class opens as soon as we verify it.",
});
sql += setting("policies", {
  refund_bn: "আমাদের রিফান্ড নীতি শীঘ্রই এখানে প্রকাশ করা হবে। কেনার আগে কোনো প্রশ্ন থাকলে অনুগ্রহ করে আমাদের সাথে যোগাযোগ করুন।",
  refund_en: "Our refund policy will be published here soon. If you have any question before buying, please contact us first.",
  privacy_bn: "আমরা শুধু ক্লাস সরবরাহ, পেমেন্ট যাচাই এবং সহায়তার জন্য আপনার নাম, ইমেইল ও ফোন নম্বর ব্যবহার করি। আপনার তথ্য তৃতীয় পক্ষের কাছে বিক্রি করা হয় না।",
  privacy_en: "We use your name, email and phone number only to deliver classes, verify payments and give support. We never sell your data to third parties.",
  terms_bn: "ক্লাসের কনটেন্ট শুধুমাত্র ভর্তি হওয়া শিক্ষার্থীর ব্যক্তিগত শেখার জন্য। অনুমতি ছাড়া ভিডিও বা রেসিপি শেয়ার, বিক্রি বা পুনঃপ্রকাশ করা যাবে না।",
  terms_en: "Class content is for the personal learning of the enrolled student only. Videos and recipes may not be shared, resold or republished without permission.",
});
sql += setting("about", {
  bn: "মাওয়াহ একাডেমি রান্না ও বেকিংয়ের একটি অনলাইন একাডেমি। আমাদের ক্লাসগুলো ঘরে বসে ধাপে ধাপে শেখার জন্য সাজানো — কেক, মিষ্টি, ফাস্টফুড, বিরিয়ানি থেকে শুরু করে ফ্রোজেন ফুড বিজনেস পর্যন্ত।",
  en: "MAWAH Academy is an online cooking and baking academy. Our classes are arranged so you can learn step by step from home — from cakes, mishti, fast food and biryani to frozen food business.",
});
sql += setting("analytics", { ga4: "", clarity: "", meta_pixel: "" });
sql += setting("chatbot", {
  enabled: true,
  greeting_bn: "আসসালামু আলাইকুম! আমি মাওয়াহ একাডেমির সহকারী। ক্লাস, দাম বা সার্টিফিকেট নিয়ে প্রশ্ন করুন।",
  greeting_en: "Hello! I am the MAWAH Academy assistant. Ask me about classes, prices or certificates.",
  faq_bn: "",
  faq_en: "",
});
sql += setting("onboarding", { dismissed: false });

sql += `
-- AI chatbot providers (keys live in Wrangler secrets — never in this table)
INSERT INTO ai_provider_configs (provider, enabled, is_active, model, temperature, max_tokens) VALUES ('workers_ai', 1, 1, '@cf/google/gemma-4-26b-a4b-it', 0.3, 600);
INSERT INTO ai_provider_configs (provider, enabled, is_active, model, temperature, max_tokens) VALUES ('gemini', 0, 0, 'gemini-flash-latest', 0.3, 600);
`;

writeFileSync(resolve(root, "worker/migrations/0002_seed_catalog.sql"), sql);
console.log(`wrote worker/migrations/0002_seed_catalog.sql (${categories.length} categories, ${courses.length} courses)`);
