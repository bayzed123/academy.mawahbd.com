import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, apiGet, photoPng, useLang } from "./helpers";

/*
 * How a banner looks, as the owner and a visitor meet it. The owner's complaint was a slider that looked blank: so "Create starter
 * banners" makes five from the real classes in one click (their own words, no prices), and each banner can take a colour, a layout, a
 * large drawing, a small line above the title and a picture focus — with a live preview of a computer and of a phone while editing.
 * A visitor sees them on the home page (and the pop-up) in both languages, on a phone, and passes the accessibility scan in every colour.
 * Runs after the admin and banner specs (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
const drawer = () => admin.getByRole("dialog");
type Banner = { id: number; title_en: string; theme: string | null; layout: string | null; icon: string | null; kicker_en: string; link_url: string; image_key: string | null };
const banners = async () => (await apiGet<{ items: Banner[] }>(admin, "/admin/banners?per_page=100&sort=sort")).items;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
  // every attempt starts from an empty list (the earlier banner specs leave theirs, and a retried group would find its own)
  const left = await banners();
  for (const b of left) await admin.evaluate((id) => fetch(`/api/admin/banners/${id}`, { method: "DELETE" }), b.id);
});
test.afterAll(async () => admin.context().close());

/** The accessibility scan of what this change draws (the slider or the pop-up), not of the rest of the page. */
const scan = async (page: Page, label: string, area: string) => {
  const axe = await new AxeBuilder({ page }).include(area).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`), label).toEqual([]);
};

test("one click makes five banners from the classes — their own words, no prices — and pressing again adds nothing", async () => {
  await admin.goto("/admin/banners");
  await expect(admin.getByRole("heading", { level: 1, name: "Banners" })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Create starter banners" })).toBeVisible();

  // it says what it will do before it does it, and Cancel changes nothing
  await admin.getByRole("button", { name: "Create starter banners" }).click();
  const ask = admin.getByRole("alertdialog");
  await expect(ask).toContainText("Makes up to 5 banners for the home-page slider from your published classes");
  await expect(ask).toContainText("No prices or discounts are written");
  await ask.getByRole("button", { name: "Cancel" }).click();
  expect(await banners()).toHaveLength(0);

  await admin.getByRole("button", { name: "Create starter banners" }).click();
  await ask.getByRole("button", { name: "Create banners" }).click();
  await expect(admin.getByText("5 banners created. They are live on the home page now.")).toBeVisible();
  const made = await banners();
  expect(made).toHaveLength(5);
  expect(made.map((b) => b.theme)).toEqual(["dark", "ruby", "gold", "ivory", "dark"]);
  for (const b of made) {
    expect(b.link_url).toMatch(/^\/courses\/[a-z0-9-]+$/);
    expect(b.kicker_en).not.toBe("");
    expect(b.icon).not.toBeNull();
  }
  // five rows, each with a colour swatch instead of a picture
  await expect(admin.locator("table tbody tr, [role=row]").filter({ has: admin.locator(".bn-swatch") })).toHaveCount(5);

  // the second press adds nothing, and says why
  await admin.getByRole("button", { name: "Create starter banners" }).click();
  await ask.getByRole("button", { name: "Create banners" }).click();
  await expect(admin.getByText("You already have 5 banners for classes — nothing was added.")).toBeVisible();
  expect(await banners()).toHaveLength(5);
});

test("the home page shows them in the owner's order as a slider — five colours, the class's words, no price — in English, in Bangla, and on a 360 px phone", async ({ browser }) => {
  const made = await banners();
  for (const [path, lang, width] of [["/en", "en", 1280], ["/", "bn", 1280], ["/en", "en", 360], ["/", "bn", 360]] as const) {
    const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US", viewport: { width, height: width < 500 ? 740 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
    const page = await ctx.newPage();
    await page.goto(path);
    const slides = page.locator(".bn-slide");
    await expect(slides).toHaveCount(5);
    const classes = await slides.evaluateAll((els) => els.map((e) => e.className));
    expect(classes.map((c) => /bn-t-(\w+)/.exec(c)?.[1])).toEqual(["dark", "ruby", "gold", "ivory", "dark"]);
    expect(classes.every((c) => c.includes("bn-plain") && /bn-l-(left|center|split)/.test(c))).toBe(true);
    // every slide has a small line, a title, a line of words and a button to its class; the large drawing is only decoration
    for (let i = 0; i < 5; i++) {
      const slide = slides.nth(i);
      await expect(slide.locator(".bn-kicker")).not.toBeEmpty();
      await expect(slide.locator(".bn-title")).not.toBeEmpty();
      await expect(slide.locator(".bn-art")).toHaveAttribute("aria-hidden", "true");
      const href = await slide.getByRole("link").first().getAttribute("href");
      expect(href).toBe(lang === "en" ? `/en${made[i].link_url}` : made[i].link_url);
    }
    expect(await page.locator(".bn-band").innerText()).not.toMatch(/৳|\bTk\b|%|discount|ছাড়/i);
    // nothing sticks out sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // every colour passes the contrast checks: look at each slide in turn (the slider scrolls)
    for (let i = 0; i < 5; i++) {
      await page.evaluate((n) => {
        const track = document.querySelector<HTMLElement>(".bn-track")!;
        track.scrollTo({ left: n * track.clientWidth, behavior: "instant" });
      }, i);
      await scan(page, `${path} ${width}px, slide ${i + 1} (${classes[i]})`, ".bn-band");
    }
    await ctx.close();
  }
});

test("editing a banner: the preview follows the form key by key, shows a phone as a phone, and the chosen look reaches the home page", async ({ browser }) => {
  await admin.goto("/admin/banners");
  const first = (await banners())[0];
  await admin.getByRole("row").filter({ hasText: first.title_en }).first().click();
  await expect(drawer()).toBeVisible();
  const frame = admin.frameLocator("iframe.bn-frame");
  await expect(frame.locator(".bn-slide")).toBeVisible();
  await expect(frame.locator(".bn-slide")).toHaveClass(/bn-t-dark/);
  await expect(frame.locator(".bn-title")).toHaveText(first.title_en);

  // colour and layout change the preview at once
  await drawer().getByLabel("Colour").selectOption("ruby");
  await expect(frame.locator(".bn-slide")).toHaveClass(/bn-t-ruby/);
  await drawer().getByLabel("Where the words go").selectOption("center");
  await expect(frame.locator(".bn-slide")).toHaveClass(/bn-l-center/);

  // typing: the caret never leaves the box, and the words appear in the preview as they are typed
  const kicker = drawer().getByLabel("Small line above the title (English)", { exact: true });
  await kicker.fill("");
  await kicker.click();
  await kicker.pressSequentially("Eid special", { delay: 20 });
  await expect(kicker).toHaveValue("Eid special");
  await expect(kicker).toBeFocused();
  await expect(frame.locator(".bn-kicker")).toHaveText("Eid special");

  // a phone is drawn as wide as a phone (and a computer as a computer, shrunk to fit), in either language
  await drawer().getByRole("button", { name: "Phone", exact: true }).click();
  await expect(admin.locator("iframe.bn-frame")).toHaveAttribute("width", "360");
  expect(await frame.locator(".bn-slide").evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBeLessThanOrEqual(336);
  await drawer().getByRole("button", { name: "Computer", exact: true }).click();
  await expect(admin.locator("iframe.bn-frame")).toHaveAttribute("width", "1100");
  await drawer().getByRole("button", { name: "বাংলা", exact: true }).click();
  await expect(frame.locator("html")).toHaveAttribute("lang", "bn");
  await drawer().getByRole("button", { name: "English", exact: true }).click();

  // the words typed are only ever text in the preview, never markup
  await kicker.fill("<img src=x onerror=alert(1)>");
  await expect(frame.locator(".bn-kicker")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(frame.locator(".bn-kicker img")).toHaveCount(0);
  await kicker.fill("Eid special");

  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const saved = (await banners())[0];
  expect(saved).toMatchObject({ theme: "ruby", layout: "center", kicker_en: "Eid special" });

  // a visitor sees it
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto("/en");
  await expect(page.locator(".bn-slide").first()).toHaveClass(/bn-t-ruby.*bn-l-center|bn-l-center.*bn-t-ruby/);
  await expect(page.locator(".bn-slide").first().locator(".bn-kicker")).toHaveText("Eid special");
  await ctx.close();
});

test("a picture banner: the picture is the art, its focus is chosen, and 'automatic' takes everything back to how it was", async ({ browser }) => {
  await admin.goto("/admin/banners");
  const target = (await banners())[1];
  await admin.getByRole("row").filter({ hasText: target.title_en }).first().click();
  await expect(drawer()).toBeVisible();
  await drawer().getByLabel("Picture", { exact: true }).setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: photoPng(1600, 600, 2) });
  await expect(drawer().locator(".thumb img").first()).toBeVisible();
  await drawer().getByLabel("Keep this part of the picture").selectOption("top");
  const frame = admin.frameLocator("iframe.bn-frame");
  await expect(frame.locator(".bn-slide")).toHaveClass(/bn-f-top/);
  await expect(frame.locator(".bn-slide")).not.toHaveClass(/bn-plain/);
  await expect(frame.locator(".bn-media img")).toHaveAttribute("src", /^\/media\/banners\/[a-f0-9]{32}\.(png|webp)$/);
  await expect(frame.locator(".bn-art")).toHaveCount(0); // the picture is the art
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();

  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto("/en");
  const slide = page.locator(".bn-slide").nth(1);
  await expect(slide).toHaveClass(/bn-f-top/);
  await expect(slide).not.toHaveClass(/bn-plain/);
  await expect(slide.locator(".bn-art")).toHaveCount(0);
  const src = await slide.locator("img").getAttribute("src");
  expect((await page.request.get(src!)).status()).toBe(200);

  // back to automatic: no focus class any more
  await admin.getByRole("row").filter({ hasText: target.title_en }).first().click();
  await drawer().getByLabel("Keep this part of the picture").selectOption({ label: "Automatic (the middle)" });
  await drawer().getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.locator(".bn-slide").nth(1)).not.toHaveClass(/bn-f-/);
  await ctx.close();
});

test("the offer pop-up takes the colour too, and every colour passes the accessibility scan with the pop-up open", async ({ browser }) => {
  for (const theme of ["dark", "ruby", "gold", "ivory"]) {
    const made = await admin.evaluate(
      async (t) => {
        const res = await fetch("/api/admin/banners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placement: "popup", title_bn: `অফার ${t}`, title_en: `Offer ${t}`, text_bn: "ছোট একটি লাইন", text_en: "One short line", kicker_bn: "এই সপ্তাহে", kicker_en: "This week", image_key: null, mobile_image_key: null, alt_bn: "", alt_en: "", button_bn: "দেখুন", button_en: "See it", link_url: "/courses", new_tab: false, active: true, starts_at: null, ends_at: null, sort: 1, popup_delay_sec: 0, popup_repeat_days: 0, popup_pages: "home", theme: t }),
        });
        return (await res.json()).item.id as number;
      },
      theme,
    );
    for (const lang of ["en", "bn"] as const) {
      const ctx = await browser.newContext({ locale: lang === "bn" ? "bn-BD" : "en-US", viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(lang === "en" ? "/en" : "/");
      const card = page.locator(".offer-card");
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toHaveClass(new RegExp(`bn-t-${theme}`));
      await expect(card.locator(".offer-kicker")).toHaveText(lang === "en" ? "This week" : "এই সপ্তাহে");
      await scan(page, `pop-up, ${theme}, ${lang}`, ".offer");
      await ctx.close();
    }
    await admin.evaluate((id) => fetch(`/api/admin/banners/${id}`, { method: "DELETE" }), made);
  }
});
