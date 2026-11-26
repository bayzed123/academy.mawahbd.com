import { describe, expect, it } from "vitest";
import { offerView } from "@mawah/shared";
import { offerEnd } from "../src/lib/price";
import { Client, env, json, loginStaff } from "./helpers";

/*
 * A class's offer (migration 0032, lib/price.ts): while it runs the class sells at its offer price — on the cards, the class page, the
 * checkout and the order — with the regular price crossed out and the saving in %. An offer with an end stops by itself; one without runs
 * until the owner removes it. The admin refuses an offer that is not lower, and a free class has none.
 */

let seq = 0;
async function makeCourse(price: number, offer: number | null = null, endsAt: string | null = null) {
  const n = ++seq;
  const slug = `offer-test-${Date.now().toString(36)}-${n}`;
  const res = await env.DB.prepare(
    `INSERT INTO courses (slug, title_bn, title_en, price, offer_price, offer_ends_at, status, category_id, instructor_id, published_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
    .bind(slug, `অফার ক্লাস ${n}`, `Offer Class ${n}`, price, offer, endsAt)
    .run();
  return { id: res.meta.last_row_id as number, slug };
}
const inHours = (h: number) => offerEnd(new Date(Date.now() + h * 3600_000).toISOString())!;
const quote = async (slug: string) => (await json<{ quote: { subtotal: number; total: number; items: { price: number; list_price: number; regular_price?: number }[] } }>(await new Client().post("/api/checkout/quote", { courses: [slug] }))).quote;
const page = async (path: string) => (await new Client().get(path)).text();

describe("a class on offer", () => {
  it("the offer view: the saving in whole per cent, never 0; nothing without an offer", () => {
    expect(offerView({ price: 1200, regular_price: 1550, offer_ends_at: null })).toEqual({ on: true, price: 1200, regular: 1550, pct: 23, ends_at: null });
    expect(offerView({ price: 999, regular_price: 1000 }).pct).toBe(1);
    expect(offerView({ price: 1000, regular_price: 1000 }).on).toBe(false);
    expect(offerView({ price: 0, regular_price: 1000 }).on).toBe(false);
    expect(offerEnd("2026-11-26T23:59")).toMatch(/^2026-11-2\dT\d\d:59:00Z$/);
    expect(offerEnd("not a date")).toBeNull();
  });

  it("sells at the offer price everywhere — cards, class page, checkout — with the regular price crossed out and the end counted down", async () => {
    const c = await makeCourse(1550, 1200, inHours(5));
    const q = await quote(c.slug);
    expect(q).toMatchObject({ subtotal: 1200, total: 1200 });
    expect(q.items[0]).toMatchObject({ price: 1200, list_price: 1200, regular_price: 1550 });

    const html = await page(`/en/courses/${c.slug}`);
    expect(html).toContain("<del>৳1,550</del>");
    expect(html).toContain("<b>৳1,200</b>");
    expect(html).toContain("23% off");
    expect(html).toMatch(/data-offer-ends="\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"/);
    expect(html).toContain('"priceValidUntil"');
    expect(html).toContain('"price":1200');
    // the class list's card too, in Bangla with Bangla digits
    const bn = await page("/courses?q=" + encodeURIComponent(`অফার ক্লাস`));
    expect(bn).toContain("২৩% ছাড়");
  });

  it("an offer with no end runs on (a lifetime offer): no countdown, no end date for Google", async () => {
    const c = await makeCourse(1000, 800);
    expect((await quote(c.slug)).total).toBe(800);
    const html = await page(`/en/courses/${c.slug}`);
    expect(html).toContain("20% off");
    expect(html).not.toContain("data-offer-ends");
    expect(html).not.toContain('"priceValidUntil"');
  });

  it("an offer that has ended is over by itself: the regular price is charged and shown, with no offer line", async () => {
    const c = await makeCourse(1550, 1200, inHours(-1));
    const q = await quote(c.slug);
    expect(q.total).toBe(1550);
    expect(q.items[0].regular_price).toBeUndefined();
    const html = await page(`/en/courses/${c.slug}`);
    expect(html).not.toContain("<del>");
    expect(html).not.toContain("% off");
  });

  it("the admin keeps it honest: lower than the price, never on a free class, cleared for an app class; the end stored in one format", async () => {
    const c = await makeCourse(1550);
    const { client } = await loginStaff("content_manager");
    const higher = await client.patch(`/api/admin/courses/${c.id}`, { offer_price: 1550 });
    expect(higher.status).toBe(422);
    expect((await json(higher)).error.fields).toEqual({ offer_price: "offer_not_lower" });
    const free = await client.patch(`/api/admin/courses/${c.id}`, { price: 0, offer_price: 100 });
    expect((await json(free)).error.fields).toEqual({ offer_price: "offer_free_class" });

    const ok = await client.patch(`/api/admin/courses/${c.id}`, { offer_price: 999, offer_ends_at: "2030-01-01T17:59:00.000Z" });
    expect(ok.status).toBe(200);
    expect((await json(ok)).item).toMatchObject({ offer_price: 999, offer_ends_at: "2030-01-01T17:59:00Z" });
    expect((await quote(c.slug)).total).toBe(999);

    // removed: back to the regular price
    await client.patch(`/api/admin/courses/${c.id}`, { offer_price: null });
    const row = await env.DB.prepare("SELECT offer_price, offer_ends_at FROM courses WHERE id = ?").bind(c.id).first();
    expect(row).toEqual({ offer_price: null, offer_ends_at: null });
    expect((await quote(c.slug)).total).toBe(1550);
  });
});
