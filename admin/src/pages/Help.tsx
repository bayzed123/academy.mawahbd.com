import { useI18n } from "../lib/i18n";
import { PageHeader, Panel } from "../components/ui";

interface Item {
  q: string;
  a: string[];
}

/** The owner's built-in handbook. Plain language, bilingual, written for a non-technical person. */
const CONTENT: Record<"bn" | "en", { title: string; groups: { title: string; items: Item[] }[]; glossary: [string, string][]; secrets: [string, string][] }> = {
  en: {
    title: "Help & guide",
    groups: [
      {
        title: "Getting started",
        items: [
          { q: "What should I do first?", a: ["Open the Dashboard — the 'First steps' card lists everything, and ticks each step off by itself.", "1) Add your contact numbers and payment numbers in Settings. 2) Write your refund policy. 3) Fill in the instructor profile with a photo. 4) Add lessons to your first class, then tell your audience."] },
          { q: "Why does the Dashboard say 'classes without lessons'?", a: ["A published class with no lessons shows an Enroll button — a student who pays would find it empty. Add at least one lesson, or switch the class to 'Coming Soon' until the lessons are ready."] },
        ],
      },
      {
        title: "Classes & lessons",
        items: [
          { q: "How do I add or edit a class?", a: ["Classes → open a class and press 'Edit this class' (or press 'Add'). Fill in the title in Bangla and English, a short description, the price in Taka and a picture, then Save. Status decides who sees it: Draft (hidden), Coming Soon (visible with a 'Notify me' form), Published (students can buy), Archived (hidden, but students who bought keep access)."] },
          { q: "How do I switch a class on or off, and what is the overview page?", a: ["In Classes every row has an 'Active on the website' switch. On: the class is on the website and can be bought. Off: it is hidden at once and nobody can buy it — nothing is deleted, and students who already enrolled keep their access. The system asks before switching off. Click a class row (or the eye icon) to open its read-only overview with real numbers; press 'Edit this class' to change it and '← Class overview' to come back."] },
          { q: "How do I add lessons?", a: ["Open the class → 'Curriculum' tab → Add module (a chapter) → Add lesson. A lesson can be a video, a link (YouTube/Vimeo), or written notes. You can attach PDFs such as recipe cards to any lesson. Use the arrows to reorder."] },
          { q: "How do I upload a video?", a: ["Choose the 'Video' type and pick the file — it goes straight to Cloudflare Stream, which converts it so it plays smoothly on slow phones. Wait until it shows 'Ready'. Videos are protected: only enrolled students can play them, and the link cannot be shared.", "Tip: a 1080p MP4 is plenty. Keep one lesson per recipe step-group (5–15 minutes)."] },
          { q: "How do I give students files, links, a live class or a private group?", a: ["Materials in the left menu → Add material (or press 'Add material' on a class's overview page). Choose the class, then what you are adding: Video, PDF, ZIP file pack, Book, Live class, Link or Private group — the form then shows only what that type needs.", "Files are uploaded right there, up to 95 MB each. For anything bigger (a long video) keep it on Google Drive / YouTube / Vimeo and paste the link instead. Only students enrolled in that class can download or open it, and every download is written to Materials → Download log. Above the materials every student is told that they are for their own learning only and must never be resold or shared.", "Private group: for a Facebook group the student first sends you their Facebook profile link. Their request appears under Materials → Group requests — open the profile, approve them inside the Facebook group, then press Approve there. WhatsApp and Telegram groups open straight away."] },
          { q: "What is a 'free preview' lesson?", a: ["Turn on 'Free preview' for one or two lessons: anyone can watch them without an account. It is the best way to let visitors try before they buy."] },
          { q: "What is 'drip' (release after days)?", a: ["On a module you can set 'Opens after N days'. The module unlocks automatically N days after a student enrolls — useful for long classes."] },
        ],
      },
      {
        title: "Payments & orders",
        items: [
          { q: "How do payments work?", a: ["Online payment (bKash, Nagad, Rocket, cards) is confirmed automatically by the payment company — the student gets access within seconds. You do nothing.", "Manual payment: the student sends money to your number and enters the transaction ID. You will see the order under Orders → 'Awaiting verification' (and a red number on the sidebar). Check your bKash/Nagad/Rocket statement, then press Approve. The class opens immediately and the student is emailed."] },
          { q: "A student says they paid but cannot see the class.", a: ["Open Orders and search their email. If the status is 'Awaiting verification', approve it after checking your statement. If it is 'Pending', the payment company has not confirmed it — ask for the transaction ID, check your statement, and as a last resort use Students → Enroll to open the class by hand."] },
          { q: "How do coupons and bundles work?", a: ["Coupons: Coupons → Add. Choose percent or fixed amount, an expiry date and a usage limit. Leave 'classes' empty to apply to everything. Bundles: sell several classes together at one price."] },
          { q: "How do I refund?", a: ["Orders → open the order → Refund (Super Admin only). The student loses access and the order is marked refunded. Send the money back yourself from your wallet or the payment company's dashboard — the system keeps the record."] },
        ],
      },
      {
        title: "Students & feedback",
        items: [
          { q: "Reviews", a: ["Only students who bought a class can review it. New reviews wait for your approval (Reviews → ✓). Approved reviews appear on the class page and in Google search stars. You can reply publicly."] },
          { q: "FAQ (what visitors ask before buying)", a: ["Open FAQ in the left menu and press + Add. A question can be for everyone (the FAQ page, and the home page if you tick it) or for one class only. Write Bangla and English if you can; if one is empty the other is shown. Switch a question off with the switch — it leaves the website at once."] },
          { q: "Questions on lessons", a: ["Students ask questions under each lesson. Answer them in Questions — answers are shown to classmates too."] },
          { q: "Certificates", a: ["A certificate is issued automatically when a student completes every lesson. It has a unique code anyone can check at /verify. You can revoke or re-issue one (for example to fix a misspelled name)."] },
          { q: "The 'notify me' list", a: ["Visitors can leave their email on a Coming Soon class. When you publish the class they are emailed automatically, once. You can see and export the list under Notify lists."] },
        ],
      },
      {
        title: "AI assistant",
        items: [
          { q: "How does the chatbot answer?", a: ["It only uses what you have published: classes, prices, your policies, the questions you keep switched on in FAQ, and the FAQ you write in AI Chatbot → Content. If it is not sure, it says so and sends the question to 'Hand-offs' for your team. Keep the FAQ up to date — it is the cheapest way to improve answers.", "You can switch between Cloudflare Workers AI and Google Gemini. Save the key, press Test connection, then Make active."] },
        ],
      },
      {
        title: "Team & security",
        items: [
          { q: "Which role should I give?", a: ["Super Admin: everything. Content Manager: classes, blog, coupons. Support: orders, students, reviews, questions. Viewer: read-only, great for an accountant."] },
          { q: "Keeping the site safe", a: ["Use a long, unique password. Deactivate people who leave (Team → Deactivate) — their sessions end instantly. Never share the Super Admin login. The Activity log records who changed what. After setup, delete the SETUP_TOKEN secret (the Dashboard reminds you)."] },
        ],
      },
    ],
    glossary: [
      ["Class", "A course students buy and watch (ক্লাস)"],
      ["Enrollment", "A student's access to a class (ভর্তি)"],
      ["Module", "A chapter inside a class (মডিউল)"],
      ["TrxID", "The transaction ID in the bKash/Nagad/Rocket confirmation message"],
      ["Coupon", "A discount code (কুপন)"],
      ["Bundle", "Several classes sold together for one price"],
      ["Material", "Anything a class gives besides lessons: a file to download, a link, a live class or a private group (ম্যাটেরিয়াল)"],
      ["Hand-off", "A chatbot question it could not answer, passed to your team"],
      ["Stream", "Cloudflare's video hosting that protects and converts your videos"],
    ],
    secrets: [
      ["APP_SECRET", "Required. Long random text used to protect passwords. Never change it without a plan (see docs)."],
      ["SETUP_TOKEN", "Used once to create the first admin. Delete it afterwards."],
      ["SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD", "Online payments (bKash, Nagad, Rocket, cards)."],
      ["RESEND_API_KEY", "Sends emails (receipts, password reset, launch announcements)."],
      ["GEMINI_API_KEY", "Optional — only if you choose Gemini for the chatbot (you can also save it in AI Chatbot)."],
      ["TURNSTILE_SECRET + TURNSTILE_SITE_KEY", "Optional bot protection on sign-up and contact forms."],
    ],
  },
  bn: {
    title: "সহায়তা ও নির্দেশিকা",
    groups: [
      {
        title: "শুরু করার ধাপ",
        items: [
          { q: "প্রথমে কী করব?", a: ["ড্যাশবোর্ডের 'প্রথম ধাপ' কার্ডটি দেখুন — সব কাজ সেখানে তালিকা করা আছে, আর কাজ শেষ হলে নিজে থেকেই টিক পড়ে।", "১) সেটিংসে যোগাযোগ ও পেমেন্টের নম্বর দিন। ২) রিফান্ড নীতি লিখুন। ৩) প্রশিক্ষকের প্রোফাইলে ছবি ও পরিচিতি দিন। ৪) প্রথম ক্লাসে লেসন যোগ করুন, তারপর দর্শকদের জানান।"] },
          { q: "ড্যাশবোর্ডে 'লেসনবিহীন ক্লাস' কেন দেখাচ্ছে?", a: ["লেসন ছাড়া প্রকাশিত ক্লাসে 'ভর্তি হোন' বোতাম থাকে — টাকা দেওয়ার পর শিক্ষার্থী ফাঁকা ক্লাস দেখবেন। অন্তত একটি লেসন যোগ করুন, অথবা লেসন তৈরি না হওয়া পর্যন্ত ক্লাসটি 'শীঘ্রই আসছে' করে রাখুন।"] },
        ],
      },
      {
        title: "ক্লাস ও লেসন",
        items: [
          { q: "ক্লাস কীভাবে যোগ বা সম্পাদনা করব?", a: ["ক্লাস → একটি ক্লাস খুলে 'এই ক্লাস সম্পাদনা করুন' চাপুন (বা 'যোগ করুন')। বাংলা ও ইংরেজিতে নাম, সংক্ষিপ্ত বিবরণ, টাকায় মূল্য ও ছবি দিয়ে সংরক্ষণ করুন। স্ট্যাটাস ঠিক করে কে দেখতে পাবে: খসড়া (লুকানো), শীঘ্রই আসছে ('জানান' ফর্মসহ দৃশ্যমান), প্রকাশিত (কেনা যাবে), আর্কাইভ (লুকানো, তবে যারা কিনেছেন তাদের অ্যাক্সেস থাকে)।"] },
          { q: "ক্লাস কীভাবে চালু বা বন্ধ করব, আর 'সারসংক্ষেপ' পাতা কী?", a: ["ক্লাস তালিকায় প্রতিটি সারিতে 'ওয়েবসাইটে চালু' সুইচ আছে। চালু: ক্লাসটি ওয়েবসাইটে আছে এবং কেনা যাবে। বন্ধ: সাথে সাথে লুকিয়ে যায়, কেউ কিনতে পারে না — কিছু মোছা হয় না, আর যারা আগেই ভর্তি হয়েছেন তাঁদের অ্যাক্সেস থাকে। বন্ধ করার আগে সিস্টেম জিজ্ঞেস করে। কোনো ক্লাসের সারিতে (বা চোখের আইকনে) চাপলে শুধু-দেখার সারসংক্ষেপ পাতা খোলে, যেখানে সত্যিকারের সংখ্যা আছে; বদলাতে 'এই ক্লাস সম্পাদনা করুন' চাপুন, ফিরতে '← ক্লাসের সারসংক্ষেপ'।"] },
          { q: "লেসন কীভাবে যোগ করব?", a: ["ক্লাস খুলে 'পাঠ্যসূচি' ট্যাব → মডিউল (অধ্যায়) যোগ করুন → লেসন যোগ করুন। লেসন হতে পারে ভিডিও, লিংক (ইউটিউব/ভিমিও) অথবা লিখিত নোট। যেকোনো লেসনে রেসিপি কার্ডের মতো পিডিএফ সংযুক্ত করা যায়। তীর চিহ্ন দিয়ে ক্রম বদলান।"] },
          { q: "ভিডিও কীভাবে আপলোড করব?", a: ["'ভিডিও' ধরন বেছে ফাইল দিন — এটি সরাসরি ক্লাউডফ্লেয়ার স্ট্রিমে যায়, যা ভিডিওকে এমনভাবে রূপান্তর করে যাতে ধীরগতির ফোনেও ভালো চলে। 'প্রস্তুত' দেখানো পর্যন্ত অপেক্ষা করুন। ভিডিও সুরক্ষিত: শুধু ভর্তি হওয়া শিক্ষার্থী চালাতে পারেন, লিংক অন্যকে দেওয়া যায় না।", "পরামর্শ: ১০৮০পি এমপি৪-ই যথেষ্ট। রেসিপির ধাপ ধরে ৫–১৫ মিনিটের লেসন বানান।"] },
          { q: "শিক্ষার্থীদের ফাইল, লিংক, লাইভ ক্লাস বা প্রাইভেট গ্রুপ কীভাবে দেব?", a: ["বাঁ মেনুর 'ম্যাটেরিয়াল' → ম্যাটেরিয়াল যোগ করুন (বা ক্লাসের সারসংক্ষেপ পাতায় 'ম্যাটেরিয়াল যোগ করুন')। ক্লাস বেছে নিন, তারপর কী যোগ করছেন: ভিডিও, পিডিএফ, জিপ ফাইল, বই, লাইভ ক্লাস, লিংক বা প্রাইভেট গ্রুপ — ফর্মে তখন শুধু ওই ধরনের দরকারি ঘরগুলোই থাকে।", "ফাইল সেখানেই আপলোড হয়, প্রতিটি সর্বোচ্চ ৯৫ এমবি। এর চেয়ে বড় (লম্বা ভিডিও) হলে গুগল ড্রাইভ / ইউটিউব / ভিমিওতে রেখে লিংক দিন। শুধু ওই ক্লাসে ভর্তি শিক্ষার্থীরাই ডাউনলোড বা খুলতে পারেন, আর প্রতিটি ডাউনলোড ম্যাটেরিয়াল → ডাউনলোডের তালিকায় লেখা থাকে। ম্যাটেরিয়ালের ওপরে প্রতিটি শিক্ষার্থীকে জানানো হয় যে এগুলো শুধু তাঁর নিজের শেখার জন্য — বিক্রি বা অন্যকে দেওয়া চলবে না।", "প্রাইভেট গ্রুপ: ফেসবুক গ্রুপ হলে শিক্ষার্থী আগে আপনাকে তাঁর ফেসবুক প্রোফাইলের লিংক পাঠান। অনুরোধটি ম্যাটেরিয়াল → গ্রুপে যোগের অনুরোধ পাতায় আসে — প্রোফাইল খুলে ফেসবুক গ্রুপে তাঁকে অনুমোদন দিন, তারপর সেখানে 'অনুমোদন' চাপুন। হোয়াটসঅ্যাপ ও টেলিগ্রাম গ্রুপের লিংক সাথে সাথে খোলে।"] },
          { q: "'ফ্রি প্রিভিউ' লেসন কী?", a: ["এক-দুটি লেসনে 'ফ্রি প্রিভিউ' চালু করলে অ্যাকাউন্ট ছাড়াই যে কেউ দেখতে পারেন। কেনার আগে ক্লাস যাচাই করার সবচেয়ে ভালো উপায় এটি।"] },
          { q: "'ড্রিপ' (কয়েক দিন পর খোলা) কী?", a: ["মডিউলে 'N দিন পর খুলবে' দিলে শিক্ষার্থী ভর্তি হওয়ার N দিন পর মডিউলটি নিজে থেকে খুলে যায় — বড় ক্লাসের জন্য কাজের।"] },
        ],
      },
      {
        title: "পেমেন্ট ও অর্ডার",
        items: [
          { q: "পেমেন্ট কীভাবে কাজ করে?", a: ["অনলাইন পেমেন্ট (বিকাশ, নগদ, রকেট, কার্ড) পেমেন্ট কোম্পানি নিজেই নিশ্চিত করে — কয়েক সেকেন্ডে শিক্ষার্থী ক্লাস পান। আপনাকে কিছু করতে হয় না।", "ম্যানুয়াল পেমেন্ট: শিক্ষার্থী আপনার নম্বরে টাকা পাঠিয়ে ট্রানজ্যাকশন আইডি দেন। অর্ডার → 'যাচাইয়ের অপেক্ষায়' তালিকায় (সাইডবারে লাল সংখ্যাসহ) দেখবেন। আপনার বিকাশ/নগদ/রকেটের স্টেটমেন্ট মিলিয়ে 'অনুমোদন' চাপুন। সাথে সাথে ক্লাস খুলে যাবে এবং শিক্ষার্থী ইমেইল পাবেন।"] },
          { q: "শিক্ষার্থী বলছেন টাকা দিয়েছেন কিন্তু ক্লাস দেখছেন না।", a: ["অর্ডারে গিয়ে তাঁর ইমেইল দিয়ে খুঁজুন। স্ট্যাটাস 'যাচাইয়ের অপেক্ষায়' হলে স্টেটমেন্ট মিলিয়ে অনুমোদন দিন। 'অপেক্ষমাণ' হলে পেমেন্ট কোম্পানি এখনো নিশ্চিত করেনি — ট্রানজ্যাকশন আইডি চেয়ে স্টেটমেন্টে দেখুন, শেষ উপায় হিসেবে শিক্ষার্থী → 'ভর্তি করুন' দিয়ে হাতে হাতে ক্লাস খুলে দিন।"] },
          { q: "কুপন ও বান্ডেল কীভাবে কাজ করে?", a: ["কুপন: কুপন → যোগ করুন। শতাংশ বা নির্দিষ্ট টাকা, মেয়াদ ও ব্যবহারসীমা দিন। 'ক্লাস' ফাঁকা রাখলে সব ক্লাসে চলবে। বান্ডেল: কয়েকটি ক্লাস একসাথে এক দামে বিক্রি করুন।"] },
          { q: "রিফান্ড কীভাবে দেব?", a: ["অর্ডার → অর্ডারটি খুলে → রিফান্ড (শুধু সুপার অ্যাডমিন)। শিক্ষার্থীর অ্যাক্সেস বন্ধ হবে এবং অর্ডার 'রিফান্ডকৃত' চিহ্নিত হবে। টাকা ফেরত আপনি নিজে ওয়ালেট বা পেমেন্ট কোম্পানির ড্যাশবোর্ড থেকে দেবেন — সিস্টেম শুধু রেকর্ড রাখে।"] },
        ],
      },
      {
        title: "শিক্ষার্থী ও মতামত",
        items: [
          { q: "রিভিউ", a: ["যিনি ক্লাস কিনেছেন শুধু তিনিই রিভিউ দিতে পারেন। নতুন রিভিউ আপনার অনুমোদনের অপেক্ষায় থাকে (রিভিউ → ✓)। অনুমোদিত রিভিউ ক্লাস পেজে এবং গুগল সার্চের তারকায় দেখা যায়। আপনি প্রকাশ্যে উত্তর দিতে পারেন।"] },
          { q: "সচরাচর জিজ্ঞাসা (কেনার আগে দর্শকরা যা জানতে চান)", a: ["বাঁ মেনুর 'সচরাচর জিজ্ঞাসা' খুলে + যোগ করুন চাপুন। প্রশ্ন হতে পারে সবার জন্য (সচরাচর জিজ্ঞাসার পাতা, টিক দিলে হোম পেজেও) অথবা শুধু একটি ক্লাসের জন্য। পারলে বাংলা ও English দুটোই লিখুন; একটি ফাঁকা থাকলে অন্যটি দেখাবে। সুইচ বন্ধ করলে প্রশ্নটি সাথে সাথে ওয়েবসাইট থেকে সরে যায়।"] },
          { q: "লেসনের প্রশ্ন", a: ["শিক্ষার্থীরা প্রতিটি লেসনের নিচে প্রশ্ন করেন। 'প্রশ্নোত্তর'-এ উত্তর দিন — উত্তর সহপাঠীরাও দেখতে পান।"] },
          { q: "সার্টিফিকেট", a: ["শিক্ষার্থী সব লেসন শেষ করলে সার্টিফিকেট নিজে থেকেই তৈরি হয়। এতে একটি অনন্য কোড থাকে, যা /verify পেজে যে কেউ যাচাই করতে পারেন। নাম ভুল থাকলে বাতিল বা নতুন করে ইস্যু করা যায়।"] },
          { q: "'জানান' তালিকা", a: ["'শীঘ্রই আসছে' ক্লাসে দর্শকরা ইমেইল রেখে যান। ক্লাস প্রকাশ করলে তাদের একবার স্বয়ংক্রিয়ভাবে ইমেইল যায়। তালিকা 'জানান তালিকা' মেনুতে দেখা ও এক্সপোর্ট করা যায়।"] },
        ],
      },
      {
        title: "এআই সহকারী",
        items: [
          { q: "চ্যাটবট কীভাবে উত্তর দেয়?", a: ["আপনি যা প্রকাশ করেছেন শুধু সেটুকুই ব্যবহার করে: ক্লাস, মূল্য, নীতিমালা, 'সচরাচর জিজ্ঞাসা'-য় চালু রাখা প্রশ্নগুলো এবং 'এআই চ্যাটবট → বিষয়বস্তু'-তে লেখা এফএকিউ। নিশ্চিত না হলে সে তা বলে দেয় এবং প্রশ্নটি আপনার টিমের জন্য 'হ্যান্ড-অফ' তালিকায় পাঠায়। এফএকিউ হালনাগাদ রাখুন — উত্তরের মান বাড়ানোর সবচেয়ে সহজ উপায় এটি।", "ক্লাউডফ্লেয়ার ওয়ার্কার্স এআই ও গুগল জেমিনির মধ্যে বদলানো যায়। কী সংরক্ষণ করে 'সংযোগ পরীক্ষা' চাপুন, তারপর 'সক্রিয় করুন'।"] },
        ],
      },
      {
        title: "টিম ও নিরাপত্তা",
        items: [
          { q: "কাকে কোন ভূমিকা দেব?", a: ["সুপার অ্যাডমিন: সবকিছু। কনটেন্ট ম্যানেজার: ক্লাস, ব্লগ, কুপন। সাপোর্ট: অর্ডার, শিক্ষার্থী, রিভিউ, প্রশ্ন। ভিউয়ার: শুধু দেখা — হিসাবরক্ষকের জন্য উপযুক্ত।"] },
          { q: "সাইট নিরাপদ রাখুন", a: ["লম্বা ও আলাদা পাসওয়ার্ড ব্যবহার করুন। কেউ চলে গেলে তাকে নিষ্ক্রিয় করুন (টিম → নিষ্ক্রিয়) — সাথে সাথে তার সেশন শেষ হয়ে যায়। সুপার অ্যাডমিনের লগইন কাউকে দেবেন না। কে কী বদলেছে তা কার্যকলাপ লগে থাকে। সেটআপ শেষে SETUP_TOKEN সিক্রেটটি মুছে দিন (ড্যাশবোর্ড মনে করিয়ে দেবে)।"] },
        ],
      },
    ],
    glossary: [
      ["ক্লাস (Class)", "যে কোর্স শিক্ষার্থীরা কেনেন ও দেখেন"],
      ["ভর্তি (Enrollment)", "একটি ক্লাসে শিক্ষার্থীর অ্যাক্সেস"],
      ["মডিউল (Module)", "ক্লাসের ভেতরের একটি অধ্যায়"],
      ["TrxID", "বিকাশ/নগদ/রকেটের কনফার্মেশন মেসেজের ট্রানজ্যাকশন আইডি"],
      ["কুপন (Coupon)", "ছাড়ের কোড"],
      ["বান্ডেল (Bundle)", "কয়েকটি ক্লাস একসাথে এক দামে"],
      ["ম্যাটেরিয়াল (Material)", "লেসনের বাইরে ক্লাসের সঙ্গে যা দেওয়া হয়: ডাউনলোডের ফাইল, লিংক, লাইভ ক্লাস বা প্রাইভেট গ্রুপ"],
      ["হ্যান্ড-অফ (Hand-off)", "চ্যাটবট যে প্রশ্নের উত্তর দিতে পারেনি, টিমের কাছে পাঠানো"],
      ["স্ট্রিম (Stream)", "ক্লাউডফ্লেয়ারের ভিডিও হোস্টিং — ভিডিও সুরক্ষিত রাখে ও রূপান্তর করে"],
    ],
    secrets: [
      ["APP_SECRET", "আবশ্যক। পাসওয়ার্ড সুরক্ষার জন্য লম্বা এলোমেলো লেখা। পরিকল্পনা ছাড়া বদলাবেন না (ডকুমেন্ট দেখুন)।"],
      ["SETUP_TOKEN", "প্রথম অ্যাডমিন তৈরির সময় একবার লাগে। এরপর মুছে দিন।"],
      ["SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD", "অনলাইন পেমেন্ট (বিকাশ, নগদ, রকেট, কার্ড)।"],
      ["RESEND_API_KEY", "ইমেইল পাঠানো (রসিদ, পাসওয়ার্ড রিসেট, ক্লাস চালুর ঘোষণা)।"],
      ["GEMINI_API_KEY", "ঐচ্ছিক — চ্যাটবটে জেমিনি বেছে নিলে (এআই চ্যাটবট পেজ থেকেও সংরক্ষণ করা যায়)।"],
      ["TURNSTILE_SECRET + TURNSTILE_SITE_KEY", "ঐচ্ছিক — সাইন-আপ ও যোগাযোগ ফর্মে বট প্রতিরোধ।"],
    ],
  },
};

export function Help() {
  const { lang, t } = useI18n();
  const c = CONTENT[lang];
  return (
    <>
      <PageHeader title={c.title} sub={t("adm.help.sub")} />
      {c.groups.map((g) => (
        <Panel key={g.title} title={g.title}>
          {g.items.map((i) => (
            <details key={i.q} className="faq">
              <summary>{i.q}</summary>
              {i.a.map((p, n) => (
                <p key={n}>{p}</p>
              ))}
            </details>
          ))}
        </Panel>
      ))}
      <div className="grid-2">
        <Panel title={t("adm.help.glossary")}>
          <dl className="glossary">
            {c.glossary.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title={t("adm.help.secrets")} className="" >
          <p className="muted">{t("adm.help.secretsSub")}</p>
          <dl className="glossary">
            {c.secrets.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <code className="code">{k}</code>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <code className="block">wrangler secret put APP_SECRET</code>
        </Panel>
      </div>
    </>
  );
}
