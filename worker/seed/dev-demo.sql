-- =============================================================================
--  LOCAL DEVELOPMENT / E2E ONLY — never run against production.
--  Gives the empty catalog something to click through: lessons for one class, a free taster class,
--  a coupon and the business settings an owner would normally fill in on the Admin -> Settings screen.
--  Re-runnable: content inserts are guarded, settings are overwritten with the demo values.
-- =============================================================================

-- instructor profile (the migration seeds a placeholder row)
UPDATE instructors SET
  bio_en = 'Home-baking teacher with a passion for making restaurant-quality recipes simple for everyone.',
  bio_bn = 'ঘরোয়া বেকিং ও রান্নার শিক্ষক — রেস্টুরেন্ট মানের রেসিপি সবার জন্য সহজ করে শেখানোই আমার কাজ।',
  headline_en = 'Lead instructor', headline_bn = 'প্রধান প্রশিক্ষক'
WHERE id = 1 AND bio_en = '';

-- the "Beginners Baking Class" gets a real curriculum
INSERT INTO modules (course_id, title_bn, title_en, sort, drip_days)
SELECT c.id, 'শুরুর আগে', 'Before you start', 1, 0 FROM courses c
WHERE c.slug = 'beginners-baking-class' AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.course_id = c.id);

INSERT INTO modules (course_id, title_bn, title_en, sort, drip_days)
SELECT c.id, 'প্রথম কেক', 'Your first cake', 2, 0 FROM courses c
WHERE c.slug = 'beginners-baking-class' AND (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) = 1;

INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, body_bn, body_en, duration_sec, is_preview, sort)
SELECT c.id, (SELECT id FROM modules WHERE course_id = c.id AND sort = 1), 'ওভেন ও সরঞ্জাম পরিচিতি', 'Meet your oven and tools', 'text', NULL,
  '## যা যা লাগবে' || char(10) || '- ওভেন (প্রি-হিট করা)' || char(10) || '- মাপার কাপ ও চামচ' || char(10) || '- কেক টিন' || char(10) || char(10) || '**টিপস:** সব উপকরণ ঘরের তাপমাত্রায় রাখুন।',
  '## What you need' || char(10) || '- An oven (pre-heated)' || char(10) || '- Measuring cups and spoons' || char(10) || '- A cake tin' || char(10) || char(10) || '**Tip:** keep every ingredient at room temperature.',
  300, 1, 1
FROM courses c WHERE c.slug = 'beginners-baking-class' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id);

INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, body_bn, body_en, duration_sec, is_preview, sort)
SELECT c.id, (SELECT id FROM modules WHERE course_id = c.id AND sort = 1), 'মাপ ও অনুপাত', 'Measuring and ratios', 'text', NULL,
  'ভালো কেকের আসল রহস্য সঠিক মাপ।', 'The secret of a good cake is accurate measuring.', 420, 0, 2
FROM courses c WHERE c.slug = 'beginners-baking-class' AND (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) = 1;

INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, body_bn, body_en, duration_sec, is_preview, sort)
SELECT c.id, (SELECT id FROM modules WHERE course_id = c.id AND sort = 2), 'ভ্যানিলা স্পঞ্জ কেক', 'Vanilla sponge cake', 'external', 'https://youtu.be/dQw4w9WgXcQ',
  'ভিডিও দেখে ধাপে ধাপে কেক বানান।', 'Follow the video step by step.', 900, 0, 1
FROM courses c WHERE c.slug = 'beginners-baking-class' AND (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) = 2;

INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, external_url, body_bn, body_en, duration_sec, is_preview, sort)
SELECT c.id, (SELECT id FROM modules WHERE course_id = c.id AND sort = 2), 'ফ্রস্টিং ও সাজানো', 'Frosting and decorating', 'text', NULL,
  'ঠান্ডা কেকে ফ্রস্টিং লাগান।', 'Frost the cake only once it is completely cool.', 600, 0, 2
FROM courses c WHERE c.slug = 'beginners-baking-class' AND (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) = 3;

UPDATE courses SET
  lesson_count = (SELECT COUNT(*) FROM lessons WHERE course_id = courses.id),
  duration_sec = (SELECT COALESCE(SUM(duration_sec), 0) FROM lessons WHERE course_id = courses.id)
WHERE slug = 'beginners-baking-class';

-- a free taster class (shows the instant-enroll path)
INSERT INTO courses (slug, title_bn, title_en, short_bn, short_en, price, status, category_id, instructor_id, level, icon, featured, sort, published_at)
SELECT 'free-taster-class', 'ফ্রি টেস্টার ক্লাস', 'Free Taster Class', 'বিনামূল্যে শুরু করুন', 'Start learning for free', 0, 'published', 1, 1, 'beginner', 'cupcake', 0, 900, strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE slug = 'free-taster-class');

INSERT INTO modules (course_id, title_bn, title_en, sort)
SELECT c.id, 'স্বাগতম', 'Welcome', 1 FROM courses c WHERE c.slug = 'free-taster-class' AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.course_id = c.id);

INSERT INTO lessons (course_id, module_id, title_bn, title_en, type, body_bn, body_en, duration_sec, is_preview, sort)
SELECT c.id, (SELECT id FROM modules WHERE course_id = c.id), 'স্বাগতম', 'Welcome', 'text', 'মাওয়াহ একাডেমিতে স্বাগতম!', 'Welcome to MAWAH Academy!', 120, 1, 1
FROM courses c WHERE c.slug = 'free-taster-class' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.course_id = c.id);

UPDATE courses SET
  lesson_count = (SELECT COUNT(*) FROM lessons WHERE course_id = courses.id),
  duration_sec = (SELECT COALESCE(SUM(duration_sec), 0) FROM lessons WHERE course_id = courses.id)
WHERE slug = 'free-taster-class';

-- a coupon
INSERT INTO coupons (code, type, value, min_order, per_student_limit, note)
SELECT 'WELCOME10', 'percent', 10, 0, 1, 'Dev demo coupon' WHERE NOT EXISTS (SELECT 1 FROM coupons WHERE code = 'WELCOME10');

-- business settings the owner would normally enter in Admin -> Settings (no policies: the site's own texts show, as on a new shop)
INSERT INTO settings (key, value) VALUES
  ('contact', '{"whatsapp":"01700000000","phone":"01700000000","email":"hello@example.test","facebook":"","youtube":"","instagram":""}'),
  ('payments', '{"sslcommerz":true,"bkash_direct":false,"manual":true,"manual_numbers":{"bkash":"01711111111","nagad":"01822222222","rocket":""},"manual_note_bn":"সেন্ড মানি করার পর ট্রানজ্যাকশন আইডি দিন।","manual_note_en":"Use Send Money, then paste the transaction ID."}'),
  -- migration 0013 puts the shop's real Google Analytics ID in the database; a local or test database must never carry it
  ('analytics', '{"ga4":"","clarity":"","meta_pixel":""}')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
