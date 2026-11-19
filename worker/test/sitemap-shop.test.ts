import { afterEach, describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, setSetting } from "../src/lib/settings";
import { Client, env, freshState, json, loginStaff } from "./helpers";

/*
 * The sitemap lists every public page — and, while the Equipment Shop is open on the website, the shop too: its front page, its
 * categories, every published product and its two policy pages, in both languages. A closed shop's pages (they say "opens soon" or are not
 * there) are left out, and so is a product that is not published.
 */
async function store(enabled: boolean) {
  await setSetting(env, "store", { ...SETTING_DEFAULTS.store, enabled }, null);
  freshState();
}
afterEach(async () => store(SETTING_DEFAULTS.store.enabled));

describe("the sitemap and the shop", () => {
  it("lists the open shop's pages and published products in both languages, and none of a closed shop", async () => {
    const admin = (await loginStaff("super_admin")).client;
    const cat = await json(await admin.post("/api/admin/shop/categories", { name_bn: "সাইটম্যাপ", name_en: "Sitemap tools", sort: 10, active: true }));
    const product = (published: boolean, n: number) =>
      admin.post("/api/admin/shop/products", {
        name_bn: `সাইটম্যাপ পণ্য ${n}`,
        name_en: `Sitemap product ${n}`,
        category_id: cat.item.id,
        short_bn: "",
        short_en: "",
        body_bn: "",
        body_en: "",
        status: published ? "published" : "draft",
        featured: false,
        sort: 100,
        variants: [{ label_bn: "১টি", label_en: "One", price: 300, list_price: 0, stock: null, sku: "" }],
      });
    const live = (await json(await product(true, 1))).item;
    const draft = (await json(await product(false, 2))).item;

    await store(true);
    const open = await (await new Client().get("/sitemap.xml")).text();
    for (const path of ["/shop", `/shop/category/${cat.item.slug}`, `/shop/p/${live.slug}`, "/policies/shop-terms", "/policies/shop-returns"]) {
      expect(open, path).toContain(`${path}</loc>`);
      expect(open, `${path} in English`).toContain(`/en${path}</loc>`);
    }
    expect(open, "a draft product is not public").not.toContain(`/shop/p/${draft.slug}<`);

    await store(false);
    const closed = await (await new Client().get("/sitemap.xml")).text();
    expect(closed).not.toContain("/shop/p/");
    expect(closed).not.toContain("/shop</loc>");
    expect(closed, "the rest is still there").toContain("/free-classes</loc>");
  });
});
