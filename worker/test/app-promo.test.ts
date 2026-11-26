import { describe, expect, it } from "vitest";
import { playStoreUrl, PLAY_URL_EXAMPLE } from "@mawah/shared";
import { Client, json, loginStaff } from "./helpers";

/*
 * "Get the app" on the website (views/appPromo.tsx): until the owner adds the app's Google Play address (Admin → Android app) the footer of
 * every page and the home page say the app is coming soon, with nothing to press; with the address, the same places link to Google Play.
 * Only an app's own Google Play page is taken, tidied; the owner can take it off the website.
 */

const PLAY = "https://play.google.com/store/apps/details?id=com.mawahacademy.app";
const page = async (path: string) => (await new Client().get(path)).text();
const badges = (html: string) => html.match(/class="play-badge[^"]*"/g) ?? [];

describe("the Google Play address", () => {
  it("takes an app's own Google Play page, tidied of what was copied along", () => {
    expect(playStoreUrl(PLAY)).toBe(PLAY);
    expect(playStoreUrl(`${PLAY}&hl=bn&gl=BD&utm_source=x&pcampaignid=web_share`)).toBe(`${PLAY}&hl=bn`);
    expect(playStoreUrl(`  ${PLAY}  `)).toBe(PLAY);
    expect(PLAY_URL_EXAMPLE).toBe(PLAY);
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      "play.google.com/store/apps/details?id=com.mawahacademy.app",
      "http://play.google.com/store/apps/details?id=com.mawahacademy.app",
      "https://play.google.com.evil.example/store/apps/details?id=com.mawahacademy.app",
      "https://evil.example/?u=https://play.google.com/store/apps/details?id=com.x.y",
      "https://play.google.com/store/apps/dev?id=123",
      "https://play.google.com/store/apps/details",
      "https://play.google.com/store/apps/details?id=nodots",
      "https://play.google.com/store/apps/details?id=com.x.y\"><script>",
      "javascript:alert(1)",
    ])
      expect(playStoreUrl(bad), bad).toBeNull();
  });
});

describe("Get the app on the website", () => {
  it("says coming soon until the address is added — in the footer of every page and on the home page — with no link to press", async () => {
    const home = await page("/en");
    expect(home).toContain('id="app-h"');
    expect(home).toContain("COMING SOON ON");
    expect(badges(home)).toEqual(['class="play-badge is-soon"']); // the home section's (the footer's corner would repeat it just below)
    expect(home).not.toContain("play.google.com");
    // another page: the footer's corner
    const classes = await page("/en/courses");
    expect(classes).toContain("Download the app on your phone");
    expect(badges(classes)).toEqual(['class="play-badge is-soon"']);
    expect(classes).not.toContain('id="app-h"');
    // no Install strip at the top, nor a menu entry, before the app is live (the home page's section and the footer say it is coming)
    expect(classes).not.toContain("data-app-strip");
    expect(classes).not.toContain('data-play="menu"');
    // in Bangla too
    expect(await page("/")).toContain("শিগগিরই আসছে");
  });

  it("the owner adds the app's address: the same places become the Google Play button; a wrong address is explained", async () => {
    const { client } = await loginStaff("super_admin");
    expect((await json(await client.get("/api/admin/app"))).play).toEqual({ show: true, url: "" });

    const wrong = await client.put("/api/admin/settings/play", { show: true, url: "https://example.com/my-app" });
    expect(wrong.status).toBe(422);
    expect((await json(wrong)).error.fields).toEqual({ url: "play_url" });
    // only a super admin changes it
    expect((await (await loginStaff("content_manager")).client.put("/api/admin/settings/play", { show: true, url: PLAY })).status).toBe(403);

    expect((await client.put("/api/admin/settings/play", { show: true, url: `${PLAY}&utm_source=share` })).status).toBe(200);
    expect((await json(await client.get("/api/admin/app"))).play).toEqual({ show: true, url: PLAY });

    const home = await page("/en");
    expect(badges(home)).toEqual(['class="play-badge"']);
    expect(home).toContain(`href="${PLAY}" target="_blank" rel="noopener noreferrer" data-play="home"`);
    const live = await page("/en/courses");
    expect(live).toContain(`href="${PLAY}" target="_blank" rel="noopener noreferrer" data-play="footer"`);
    // the Install strip at the top of every page, and the menu's entry, now open Google Play
    expect(live).toContain("data-app-strip");
    expect(live).toContain(`href="${PLAY}" target="_blank" rel="noopener noreferrer" data-play="strip"`);
    expect(live).toContain(`href="${PLAY}" target="_blank" rel="noopener noreferrer" data-play="menu"`);
    expect(home).toContain("data-app-strip");
    expect(home).toContain("GET IT ON");
    expect(home).not.toContain("COMING SOON ON");
    expect(await page("/")).toContain("ডাউনলোড করুন");

    // taken off the website: gone everywhere, the address kept
    expect((await client.put("/api/admin/settings/play", { show: false, url: PLAY })).status).toBe(200);
    const off = await page("/en");
    expect(badges(off)).toEqual([]);
    const hidden = await page("/en/courses");
    expect(badges(hidden)).toEqual([]);
    expect(hidden).not.toContain("data-app-strip");
    expect(hidden).not.toContain('data-play="menu"');
    expect(off).not.toContain('id="app-h"');
    expect((await json(await client.get("/api/admin/app"))).play).toEqual({ show: false, url: PLAY });

    // back to how a new site starts: coming soon
    expect((await client.put("/api/admin/settings/play", { show: true, url: "" })).status).toBe(200);
    expect(badges(await page("/en"))).toEqual(['class="play-badge is-soon"']);
    expect(badges(await page("/en/courses"))).toEqual(['class="play-badge is-soon"']);
  });
});
