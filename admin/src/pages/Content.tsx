import { ACCENTS } from "@mawah/shared";
import { useI18n } from "../lib/i18n";
import type { FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { Chip, StatusChip } from "../components/ui";

/* =============================================================================================== instructors */
interface Instructor {
  id: number;
  name_bn: string;
  name_en: string;
  headline_en: string;
  headline_bn: string;
  active: number;
  sort: number;
  photo_key: string | null;
  deleted_at: string | null;
}

export function Instructors() {
  const { t, pick } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "name_bn", label: t("adm.f.nameBn"), half: true, required: true, maxLength: 120 },
    { type: "text", key: "name_en", label: t("adm.f.nameEn"), half: true, required: true, maxLength: 120 },
    { type: "text", key: "headline_bn", label: t("adm.f.headlineBn"), half: true, maxLength: 160 },
    { type: "text", key: "headline_en", label: t("adm.f.headlineEn"), half: true, maxLength: 160 },
    { type: "image", key: "photo_key", label: t("adm.f.photo"), folder: "photos", maxWidth: 640 },
    { type: "markdown", key: "bio_bn", label: t("adm.f.bioBn"), rows: 6, maxLength: 4000 },
    { type: "markdown", key: "bio_en", label: t("adm.f.bioEn"), rows: 6, maxLength: 4000 },
    { type: "textarea", key: "credentials", label: t("adm.f.credentials"), hint: t("adm.f.credentialsHint"), maxLength: 600 },
    { type: "links", key: "links", label: t("adm.f.links") },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999, hint: t("adm.f.sortHint") },
    { type: "switch", key: "active", label: t("adm.f.active"), half: true },
  ];
  return (
    <ResourcePage<Instructor>
      title={t("adm.nav.instructors")}
      sub={t("adm.instructors.sub")}
      endpoint="/instructors"
      perms={{ write: "instructors:write" }}
      fields={fields}
      defaults={{ name_bn: "", name_en: "", headline_bn: "", headline_en: "", bio_bn: "", bio_en: "", credentials: "", photo_key: null, links: [], active: true, sort: 100 }}
      rowLabel={(r) => r.name_en}
      defaultSort="sort"
      trash
      columns={[
        { key: "name", label: t("label.name"), sort: "name_en", render: (r) => <b>{pick(r, "name")}</b> },
        { key: "headline", label: t("adm.f.headline"), desktopOnly: true, render: (r) => pick(r, "headline") },
        { key: "active", label: t("label.status"), render: (r) => <StatusChip status={r.active ? "active" : "draft"} /> },
        { key: "sort", label: t("adm.f.sort"), sort: "sort", desktopOnly: true },
      ]}
    />
  );
}

/* =============================================================================================== categories */
interface Category {
  id: number;
  name_bn: string;
  name_en: string;
  accent: string;
  icon: string;
  sort: number;
  active: number;
}

export function Categories() {
  const { t, pick } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "name_bn", label: t("adm.f.nameBn"), half: true, required: true, maxLength: 80 },
    { type: "text", key: "name_en", label: t("adm.f.nameEn"), half: true, required: true, maxLength: 80 },
    { type: "text", key: "blurb_bn", label: t("adm.f.blurbBn"), half: true, maxLength: 200 },
    { type: "text", key: "blurb_en", label: t("adm.f.blurbEn"), half: true, maxLength: 200 },
    { type: "select", key: "accent", label: t("adm.f.accent"), half: true, options: ACCENTS.map((a) => ({ value: a, label: t(`adm.accent.${a}` as "adm.accent.snack") })), hint: t("adm.f.accentHint") },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999 },
    { type: "icon", key: "icon", label: t("adm.f.icon") },
    { type: "switch", key: "active", label: t("adm.f.active"), half: true },
  ];
  return (
    <ResourcePage<Category>
      title={t("adm.cats.title")}
      sub={t("adm.cats.sub")}
      endpoint="/categories"
      perms={{ write: "categories:write" }}
      fields={fields}
      defaults={{ name_bn: "", name_en: "", blurb_bn: "", blurb_en: "", accent: "snack", icon: "cake", sort: 100, active: true }}
      rowLabel={(r) => r.name_en}
      defaultSort="sort"
      csv={false}
      columns={[
        { key: "name", label: t("label.name"), sort: "name_en", render: (r) => <b>{pick(r, "name")}</b> },
        { key: "accent", label: t("adm.f.accent"), render: (r) => <Chip tone="gold">{t(`adm.accent.${r.accent}` as "adm.accent.snack")}</Chip> },
        { key: "active", label: t("label.status"), render: (r) => <StatusChip status={r.active ? "active" : "draft"} /> },
        { key: "sort", label: t("adm.f.sort"), sort: "sort", desktopOnly: true },
      ]}
    />
  );
}

/* ==================================================================================================== blog */
interface Post {
  id: number;
  title_bn: string;
  title_en: string;
  status: string;
  published_at: string | null;
  updated_at: string;
}

export function Blog() {
  const { t, pick, date } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "title_bn", label: t("adm.f.titleBn"), half: true, required: true, maxLength: 200 },
    { type: "text", key: "title_en", label: t("adm.f.titleEn"), half: true, required: true, maxLength: 200 },
    { type: "textarea", key: "excerpt_bn", label: t("adm.f.excerptBn"), half: true, maxLength: 400 },
    { type: "textarea", key: "excerpt_en", label: t("adm.f.excerptEn"), half: true, maxLength: 400 },
    { type: "image", key: "cover_key", label: t("adm.f.cover"), folder: "blog", maxWidth: 1400 },
    { type: "markdown", key: "body_bn", label: t("adm.f.bodyBn"), rows: 12 },
    { type: "markdown", key: "body_en", label: t("adm.f.bodyEn"), rows: 12 },
    { type: "text", key: "tags", label: t("adm.f.tags"), hint: t("adm.f.tagsHint"), maxLength: 200 },
    { type: "select", key: "status", label: t("label.status"), half: true, options: [{ value: "draft", label: t("status.draft") }, { value: "published", label: t("status.published") }] },
    { type: "date", key: "published_at", label: t("adm.f.publishedAt"), half: true, hint: t("adm.f.publishedAtHint") },
    { type: "section", key: "seo", label: t("adm.f.seo") },
    { type: "text", key: "seo_title_bn", label: t("adm.f.seoTitleBn"), half: true, maxLength: 120 },
    { type: "text", key: "seo_title_en", label: t("adm.f.seoTitleEn"), half: true, maxLength: 120 },
    { type: "textarea", key: "seo_desc_bn", label: t("adm.f.seoDescBn"), half: true, maxLength: 320 },
    { type: "textarea", key: "seo_desc_en", label: t("adm.f.seoDescEn"), half: true, maxLength: 320 },
  ];
  return (
    <ResourcePage<Post>
      title={t("adm.nav.blog")}
      sub={t("adm.blog.sub")}
      endpoint="/blog"
      perms={{ write: "blog:write" }}
      fields={fields}
      wide
      defaults={{ title_bn: "", title_en: "", excerpt_bn: "", excerpt_en: "", body_bn: "", body_en: "", cover_key: null, tags: "", status: "draft", published_at: null, seo_title_bn: "", seo_title_en: "", seo_desc_bn: "", seo_desc_en: "" }}
      rowLabel={(r) => r.title_en}
      defaultSort="-updated_at"
      trash
      filters={[{ key: "status", label: t("label.status"), options: [{ value: "draft", label: t("status.draft") }, { value: "published", label: t("status.published") }] }]}
      columns={[
        { key: "title", label: t("adm.f.title"), sort: "title_en", render: (r) => <b>{pick(r, "title")}</b> },
        { key: "status", label: t("label.status"), sort: "status", render: (r) => <StatusChip status={r.status} /> },
        { key: "published_at", label: t("adm.f.publishedAt"), sort: "published_at", desktopOnly: true, render: (r) => date(r.published_at) },
        { key: "updated_at", label: t("adm.f.updated"), sort: "updated_at", desktopOnly: true, render: (r) => date(r.updated_at) },
      ]}
    />
  );
}

/* ================================================================================================= bundles */
interface Bundle {
  id: number;
  title_bn: string;
  title_en: string;
  price: number;
  status: string;
  course_ids: number[];
}

export function Bundles() {
  const { t, pick, money, num } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "title_bn", label: t("adm.f.titleBn"), half: true, required: true, maxLength: 160 },
    { type: "text", key: "title_en", label: t("adm.f.titleEn"), half: true, required: true, maxLength: 160 },
    { type: "textarea", key: "desc_bn", label: t("adm.f.descBn"), half: true, maxLength: 600 },
    { type: "textarea", key: "desc_en", label: t("adm.f.descEn"), half: true, maxLength: 600 },
    { type: "number", key: "price", label: t("adm.f.bundlePrice"), half: true, min: 0, suffix: "৳", hint: t("adm.f.bundlePriceHint") },
    { type: "select", key: "status", label: t("label.status"), half: true, options: [{ value: "draft", label: t("status.draft") }, { value: "published", label: t("status.published") }, { value: "archived", label: t("status.archived") }] },
    { type: "image", key: "banner_key", label: t("adm.f.banner"), folder: "banners", maxWidth: 1280 },
    { type: "courses", key: "course_ids", label: t("adm.f.bundleClasses"), required: true },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999 },
  ];
  return (
    <ResourcePage<Bundle>
      title={t("adm.nav.bundles")}
      sub={t("adm.bundles.sub")}
      endpoint="/bundles"
      perms={{ write: "bundles:write" }}
      fields={fields}
      defaults={{ title_bn: "", title_en: "", desc_bn: "", desc_en: "", price: 0, status: "draft", banner_key: null, sort: 100, course_ids: [] }}
      rowLabel={(r) => r.title_en}
      defaultSort="sort"
      trash
      filters={[{ key: "status", label: t("label.status"), options: ["draft", "published", "archived"].map((s) => ({ value: s, label: t(`status.${s}` as "status.draft") })) }]}
      columns={[
        { key: "title", label: t("adm.f.title"), sort: "title_en", render: (r) => <b>{pick(r, "title")}</b> },
        { key: "price", label: t("label.price"), sort: "price", className: "num", render: (r) => money(r.price) },
        { key: "classes", label: t("adm.nav.courses"), desktopOnly: true, render: (r) => num(r.course_ids?.length ?? 0) },
        { key: "status", label: t("label.status"), render: (r) => <StatusChip status={r.status} /> },
      ]}
    />
  );
}

/* ================================================================================================= coupons */
interface Coupon {
  id: number;
  code: string;
  type: "percent" | "flat";
  value: number;
  used_count: number;
  max_uses: number | null;
  expires_at: string | null;
  active: number;
  note: string;
}

export function Coupons() {
  const { t, money, num, date } = useI18n();
  const fields: FieldDef[] = [
    { type: "text", key: "code", label: t("adm.f.code"), half: true, required: true, maxLength: 40, hint: t("adm.f.codeHint") },
    { type: "select", key: "type", label: t("adm.f.discountType"), half: true, options: [{ value: "percent", label: t("adm.f.percent") }, { value: "flat", label: t("adm.f.flat") }] },
    { type: "number", key: "value", label: t("adm.f.discountValue"), half: true, min: 1, hint: t("adm.f.discountValueHint") },
    { type: "number", key: "max_discount", label: t("adm.f.maxDiscount"), half: true, min: 0, nullable: true, suffix: "৳", hint: t("adm.f.maxDiscountHint") },
    { type: "number", key: "min_order", label: t("adm.f.minOrder"), half: true, min: 0, suffix: "৳" },
    { type: "number", key: "per_student_limit", label: t("adm.f.perStudent"), half: true, min: 1, max: 100 },
    { type: "date", key: "starts_at", label: t("adm.f.startsAt"), half: true },
    { type: "date", key: "expires_at", label: t("adm.f.expiresAt"), half: true },
    { type: "number", key: "max_uses", label: t("adm.f.maxUses"), half: true, min: 1, nullable: true, hint: t("adm.f.maxUsesHint") },
    { type: "switch", key: "active", label: t("adm.f.active"), half: true },
    { type: "text", key: "note", label: t("adm.f.note"), maxLength: 200 },
    { type: "courses", key: "course_ids", label: t("adm.f.couponClasses"), hint: t("adm.f.couponClassesHint") },
  ];
  return (
    <ResourcePage<Coupon>
      title={t("adm.nav.coupons")}
      sub={t("adm.coupons.sub")}
      endpoint="/coupons"
      perms={{ write: "coupons:write" }}
      fields={fields}
      defaults={{ code: "", type: "percent", value: 10, min_order: 0, max_discount: null, starts_at: null, expires_at: null, max_uses: null, per_student_limit: 1, active: true, note: "", course_ids: [] }}
      rowLabel={(r) => r.code}
      defaultSort="-created_at"
      trash
      columns={[
        { key: "code", label: t("adm.f.code"), sort: "code", render: (r) => <code className="code">{r.code}</code> },
        { key: "value", label: t("adm.f.discountValue"), render: (r) => (r.type === "percent" ? `${num(r.value)}%` : money(r.value)) },
        { key: "used", label: t("adm.f.used"), sort: "used_count", render: (r) => `${num(r.used_count)}${r.max_uses ? ` / ${num(r.max_uses)}` : ""}` },
        { key: "expires", label: t("adm.f.expiresAt"), sort: "expires_at", desktopOnly: true, render: (r) => (r.expires_at ? date(r.expires_at) : "—") },
        { key: "active", label: t("label.status"), render: (r) => <StatusChip status={r.active ? "active" : "draft"} /> },
      ]}
    />
  );
}
