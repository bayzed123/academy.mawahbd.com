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
          { q: "How do I show more pictures of a class?", a: ["Open the class → 'Edit this class' → the 'Pictures' tab. Choose several pictures at once (up to 12): each is shrunk in your browser first, so the page stays fast. Optionally write a short caption in Bangla and English under each (press 'Save' on that picture), change the order with the arrow buttons, or remove one with the bin — every change on this tab saves by itself.", "On the class page the pictures appear in a row under the main banner (the banner itself is set in 'Details'). Tapping one opens it large; the arrows on the keyboard, the buttons or a swipe on a phone move to the next one, and Esc or the ✕ closes it. A class with no extra pictures looks exactly as before."] },
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
          { q: "Do buyers have to log in?", a: ["No. On the class page 'Enroll Now' opens the checkout, which asks for a name, a mobile number and an address — an e-mail only if they want to give one. The student profile (with its own student ID, like STU-000123) is made for them automatically and they are signed in on that phone. The receipt goes by e-mail (if they gave one) and by text message to their number, with a link to choose a password for other phones. A buyer with no e-mail is known by the mobile number: they sign in with the number or the student ID.", "Someone who started to buy and did not finish is not a student: their name, phone and address stay in Orders (pending, later cancelled) so you can call or WhatsApp them, and the temporary account is deleted after 30 days. If they type the e-mail — or, with no e-mail, the number — of an existing student, that account is never opened: they are asked to sign in (or are sent a link) and then pay."] },
          { q: "How do I add a student who studied with me before, or paid in cash?", a: ["Students → Add student. Give the name and an e-mail or a mobile number (an old student may have only a number — they then sign in with it; the address and a private note are optional), tick the classes they have, say the day they really joined, and — if they paid — the amount, how, and the day. The payment is written down as a normal paid order on that day (it shows in Orders and in your income reports) and nothing is e-mailed to them. They have no password yet, so use 'E-mail a link to choose a password', 'Text a link to choose a password' or 'Get a sign-in link to send myself' (WhatsApp / Messenger).", "Many people at once: Students → Import a list. Download the template, fill it in Excel or Google Sheets, paste it (or choose the CSV), press 'Check my list' — every line is checked and the ones with a problem are explained — then 'Add'. Nobody is added twice, and you can import the same list again safely."] },
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
          { q: "Where do e-mails go, and how do I get a copy of everything that happens?", a: ["Every event reaches your inbox: a paid order, a payment waiting to be checked, a contact message, a new student, a question on a class, a review waiting for approval, a chatbot hand-over, a private-group request, a 'notify me' sign-up and a newsletter sign-up. They go to mawahacademy@gmail.com. Settings → E-mail → Notifications to you adds more addresses, switches single kinds off and sends a test.", "The e-mails come from no-reply@mawahacademy.com; Gmail itself cannot be the sender with Resend. Pressing Reply answers to your Gmail inbox. If the domain is not verified at Resend yet, your own notifications still arrive through Resend's test sender, but students' receipts are not sent — Settings → E-mail → 'Send me a test e-mail' says what to do (the DNS records are in docs/email-dns-records.txt). To change the key, change the GitHub secret RESEND_API_KEY and run Deploy."] },
          { q: "How do text messages (SMS) work, and how do I know they are working?", a: ["Receipts, the link to choose a password, and 'we got your payment details' go to the student's mobile number by text message. A buyer who gave no e-mail is reached only this way. Two secrets make it work: SMS_API_KEY (the key from your SMS company's panel) and SMS_API_URL (the company's address, for example https://msg.mram.com.bd). Add them as GitHub secrets (then run Deploy) or directly in the Cloudflare Worker's settings. They are never shown on any screen.", "Settings → SMS tells you if both are set, shows 'Check my SMS credit' (the balance at the company) and 'Send test message' (type your own number). If something is wrong it says what in plain words — wrong key, no credit left, sender name not approved, your server's address not allowed at the company — and what to do. A small card on the Dashboard turns amber while the last real message was refused. The sender name (the 'sender ID' the company approved) goes in the same screen; leave it empty to use the company's default. You can also switch texts off, or send them only to students who gave no e-mail."] },
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
      ["GA4_SERVICE_ACCOUNT_JSON", "Optional — the Google service-account key file that lets the Analytics screen show your visitor numbers (never share it; see Analytics)."],
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
          { q: "ক্লাসের আরও ছবি কীভাবে দেখাব?", a: ["ক্লাস খুলে 'ক্লাসটি সম্পাদনা করুন' → 'ছবি' ট্যাব। একসঙ্গে কয়েকটি ছবি বেছে নিন (সর্বোচ্চ ১২টি): প্রতিটি আপনার ব্রাউজারেই ছোট করে নেওয়া হয়, তাই পেজ দ্রুত থাকে। চাইলে প্রতিটির নিচে বাংলা ও ইংরেজিতে ছোট ক্যাপশন লিখুন (ওই ছবির 'সংরক্ষণ' চাপুন), তীর বোতামে ক্রম বদলান, বা ডাস্টবিনে সরিয়ে দিন — এই ট্যাবের প্রতিটি পরিবর্তন নিজে থেকেই সংরক্ষিত হয়।", "ক্লাসের পেজে মূল ব্যানারের নিচে ছবিগুলো সারি করে দেখাবে (ব্যানার ঠিক হয় 'বিস্তারিত' ট্যাবে)। কোনো ছবিতে চাপলে বড় হয়ে খুলবে; কিবোর্ডের তীর, বোতাম বা ফোনে সোয়াইপ দিয়ে পরেরটিতে যাওয়া যায়, Esc বা ✕ চাপলে বন্ধ হয়। বাড়তি ছবি না দিলে ক্লাসের পেজ আগের মতোই থাকে।"] },
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
          { q: "ক্রেতাকে কি লগইন করতে হয়?", a: ["না। ক্লাস পেজে 'এখনই ভর্তি হন' চাপলে চেকআউট খোলে, সেখানে নাম, মোবাইল নম্বর ও ঠিকানা দিতে হয় — ইমেইল দিতে চাইলে দিতে পারেন, না দিলেও চলে। ক্রেতার স্টুডেন্ট প্রোফাইল (নিজস্ব স্টুডেন্ট আইডিসহ, যেমন STU-000123) নিজে থেকে তৈরি হয় এবং ওই ফোনে তিনি লগইন অবস্থায় থাকেন। রসিদ ইমেইলে (দিয়ে থাকলে) এবং তাঁর নম্বরে এসএমএসে যায়, সঙ্গে অন্য ফোনের জন্য পাসওয়ার্ড দেওয়ার লিংক। যিনি ইমেইল দেননি তিনি মোবাইল নম্বর দিয়ে পরিচিত: নম্বর বা স্টুডেন্ট আইডি দিয়ে সাইন ইন করেন।", "যিনি কেনা শুরু করে শেষ করেননি তিনি শিক্ষার্থী নন: তাঁর নাম, ফোন ও ঠিকানা অর্ডারে (অপেক্ষমান, পরে বাতিল) থাকে — ফোন বা হোয়াটসঅ্যাপে যোগাযোগ করতে পারেন; ৩০ দিন পর অস্থায়ী অ্যাকাউন্টটি মুছে যায়। আগে থেকে থাকা শিক্ষার্থীর ইমেইল — বা ইমেইল না দিলে নম্বর — লিখলে সেই অ্যাকাউন্ট কখনো খোলে না: তাঁকে সাইন ইন করতে বলা হয় (বা লিংক পাঠানো হয়), তারপর পেমেন্ট।"] },
          { q: "আগে যিনি আমার সাথে শিখেছেন বা নগদ টাকা দিয়েছেন, তাঁকে কীভাবে যোগ করব?", a: ["শিক্ষার্থী → শিক্ষার্থী যোগ করুন। নাম এবং ইমেইল বা মোবাইল নম্বর দিন (পুরোনো শিক্ষার্থীর শুধু নম্বর থাকতে পারে — তিনি তখন নম্বর দিয়েই সাইন ইন করবেন; ঠিকানা ও ব্যক্তিগত নোট ঐচ্ছিক), তাঁর ক্লাসগুলো টিক দিন, কবে ভর্তি হয়েছেন সেই তারিখ দিন, আর টাকা দিয়ে থাকলে পরিমাণ, কীভাবে ও কোন তারিখে। পেমেন্টটি সেই তারিখের একটি স্বাভাবিক পেইড অর্ডার হিসেবে লেখা হয় (অর্ডার ও আয়ের রিপোর্টে দেখা যায়), তাঁকে কোনো ইমেইল যায় না। তাঁর এখনো পাসওয়ার্ড নেই — তাই 'পাসওয়ার্ড দেওয়ার লিংক ইমেইল করুন', 'পাসওয়ার্ড দেওয়ার লিংক এসএমএসে পাঠান' বা 'নিজে পাঠানোর জন্য সাইন-ইন লিংক নিন' (হোয়াটসঅ্যাপ/মেসেঞ্জার) ব্যবহার করুন।", "একসাথে অনেকজন: শিক্ষার্থী → তালিকা থেকে যোগ করুন। টেমপ্লেট নামিয়ে Excel বা Google Sheets-এ পূরণ করুন, পেস্ট করুন (বা CSV ফাইল বাছুন), 'আমার তালিকা যাচাই করুন' চাপুন — প্রতিটি লাইন যাচাই হয়, সমস্যা থাকলে কারণ লেখা হয় — তারপর '…টি লাইন যোগ করুন'। কেউ দুইবার যোগ হয় না; একই তালিকা আবার দিলেও সমস্যা নেই।"] },
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
          { q: "ইমেইল কোথায় যায়, আর সব ঘটনার কপি কীভাবে পাব?", a: ["প্রতিটি ঘটনা আপনার ইনবক্সে আসে: নতুন পেমেন্ট, যাচাইয়ের অপেক্ষায় থাকা পেমেন্ট, যোগাযোগ বার্তা, নতুন শিক্ষার্থী, ক্লাসে প্রশ্ন, অনুমোদনের অপেক্ষায় রিভিউ, চ্যাটবট থেকে হস্তান্তর, প্রাইভেট গ্রুপে যোগ দেওয়ার অনুরোধ, 'জানাও' সাইন-আপ এবং নিউজলেটার সাইন-আপ। সব যায় mawahacademy@gmail.com-এ। সেটিংস → ইমেইল → আপনার কাছে নোটিফিকেশন থেকে আরও ঠিকানা যোগ, আলাদা ধরন বন্ধ এবং টেস্ট পাঠানো যায়।", "ইমেইলগুলো আসে no-reply@mawahacademy.com থেকে; Resend-এ জিমেইল নিজে প্রেরক হতে পারে না। রিপ্লাই চাপলে উত্তর আপনার জিমেইলে যায়। Resend-এ ডোমেইন যাচাই না হলে আপনার নিজের নোটিফিকেশন Resend-এর পরীক্ষামূলক প্রেরক দিয়ে আসে, কিন্তু শিক্ষার্থীদের রসিদ যায় না — সেটিংস → ইমেইল → 'আমাকে একটি পরীক্ষামূলক ইমেইল পাঠান' চাপলে কী করতে হবে বলে দেয় (DNS রেকর্ড আছে docs/email-dns-records.txt-এ)। কী বদলাতে GitHub-এর RESEND_API_KEY সিক্রেট বদলে Deploy চালান।"] },
          { q: "এসএমএস কীভাবে কাজ করে, আর ঠিকমতো চলছে কি না কীভাবে বুঝব?", a: ["রসিদ, পাসওয়ার্ড দেওয়ার লিংক এবং 'আপনার পেমেন্টের তথ্য পেয়েছি' — শিক্ষার্থীর মোবাইল নম্বরে এসএমএসে যায়। যিনি ইমেইল দেননি তাঁকে শুধু এভাবেই জানানো যায়। দুটি সিক্রেট থাকলে কাজ করে: SMS_API_KEY (আপনার এসএমএস কোম্পানির প্যানেলের কী) আর SMS_API_URL (কোম্পানির ঠিকানা, যেমন https://msg.mram.com.bd)। এগুলো GitHub সিক্রেটে দিন (তারপর Deploy চালান) অথবা সরাসরি Cloudflare Worker-এর সেটিংসে। কোনো স্ক্রিনে এগুলো দেখানো হয় না।", "সেটিংস → এসএমএস বলে দেয় দুটোই বসানো আছে কি না, আর আছে 'আমার এসএমএস ক্রেডিট দেখুন' (কোম্পানিতে কত বাকি) ও 'পরীক্ষামূলক বার্তা পাঠান' (নিজের নম্বর লিখুন)। কিছু ভুল থাকলে সহজ ভাষায় বলে দেয় কী ভুল — কী ঠিক নেই, ক্রেডিট শেষ, সেন্ডার নাম অনুমোদিত নয়, বা আপনার সার্ভারের ঠিকানা কোম্পানিতে অনুমোদিত নয় — আর কী করতে হবে। শেষ আসল বার্তাটি প্রত্যাখ্যান হলে ড্যাশবোর্ডের ছোট কার্ডটি হলুদ হয়ে যায়। সেন্ডার নাম (কোম্পানির অনুমোদিত 'সেন্ডার আইডি') একই স্ক্রিনে বসান; ফাঁকা রাখলে কোম্পানির ডিফল্ট ব্যবহার হয়। চাইলে এসএমএস বন্ধ রাখতে পারেন, বা শুধু ইমেইল-না-দেওয়া শিক্ষার্থীদের পাঠাতে পারেন।"] },
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
      ["GA4_SERVICE_ACCOUNT_JSON", "ঐচ্ছিক — Google সার্ভিস অ্যাকাউন্টের কী ফাইল, যা অ্যানালিটিক্স পাতায় ভিজিটরের সংখ্যা দেখায় (কাউকে দেখাবেন না; অ্যানালিটিক্স পাতা দেখুন)।"],
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
