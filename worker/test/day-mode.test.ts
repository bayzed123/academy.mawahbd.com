import { describe, expect, it } from "vitest";
import THEME_SRC from "../../marketing/theme.js?raw";
import APP_HTML from "../../app/index.html?raw";
import ADMIN_HTML from "../../admin/index.html?raw";
import { CSS, THEME_CSS, THEME_JS } from "../src/generated/assets";
import { generateCertificateCode } from "../src/lib/crypto";
import { Client, env, firstCourse, registerStudent } from "./helpers";

/*
 * Night and day (the owner's fifth round). The night look is the site's own; the "Theme" button in the header switches to the day look
 * (shared/styles/theme.css) and back. marketing/theme.js keeps the choice in this browser (localStorage) — without one it follows the
 * device's own setting — and sets it on <html> before the page is drawn, so a page never flashes in the other look first and every visitor
 * still gets the same cached page. It is a file of the site's own: the policy runs no inline script. The day look's rules are a cached
 * file of their own too, so a page in the night look does not carry them. The admin keeps its one look; certificates and invoices their paper.
 */
const scriptSrc = (res: Response) => (/script-src ([^;]+)/.exec(res.headers.get("content-security-policy") ?? "")?.[1] ?? "").split(" ");

describe("the night / day switch on the site", () => {
  it("sets the visitor's look in <head>, before anything is drawn, from files the policy allows — no inline script", async () => {
    for (const path of ["/", "/en", "/en/courses", "/en/faq", "/contact"]) {
      const res = await new Client().get(path);
      const html = await res.text();
      const head = html.slice(0, html.indexOf("</head>"));
      // the phone's bar starts in the night look's pitch black (the script turns it ivory by day)
      expect(head, path).toContain('<meta name="theme-color" content="#000000"/>');
      // after the page's own styles, the day look's file — holding up the page only on a device set to light — then the plain (blocking)
      // script that sets the look and switches that file on for a visitor who chose the day look: all before anything is painted
      const link = head.indexOf(`<link rel="stylesheet" href="${THEME_CSS}" media="(prefers-color-scheme: light)" id="theme-css"/>`);
      const boot = head.indexOf(`<script src="${THEME_JS}"></script>`);
      expect(link, path).toBeGreaterThan(head.lastIndexOf("</style>"));
      expect(boot, path).toBeGreaterThan(link);
      expect(scriptSrc(res)[0], path).toBe("'self'");
      expect(res.headers.get("content-security-policy"), path).not.toContain("unsafe-inline");
    }
  });

  it("keeps the visitor's own choice (else the device's setting), survives a browser that blocks storage, and colours the phone's bar", () => {
    expect(THEME_JS).toBe("/theme.js");
    expect(THEME_SRC).toContain('var KEY = "mawah_theme";');
    // a stored choice first, the device's setting only without one
    expect(THEME_SRC).toContain("var initial = readStored() || systemTheme();");
    expect(THEME_SRC).toContain('window.matchMedia("(prefers-color-scheme: light)")');
    // reading and writing the choice never throws (private windows, blocked storage)
    expect(THEME_SRC.match(/try \{/g)?.length).toBe(2);
    expect(THEME_SRC).toContain('root.setAttribute("data-theme", next);');
    expect(THEME_SRC).toContain('next === "light" ? "#fbf7ee" : "#000000"');
    expect(THEME_SRC).toContain('if (css && next === "light") css.media = "all";');
    // the site's buttons and the student app follow one switch
    expect(THEME_SRC).toContain('new CustomEvent("mawah:theme"');
    expect(THEME_SRC).toContain("window.MawahTheme = {");
    // nothing that reaches the network, the page's text or a cookie
    expect(THEME_SRC).not.toMatch(/fetch|XMLHttpRequest|innerHTML|document\.write|cookie/);
  });

  it("puts the switch in the header beside the language switch, named in both languages", async () => {
    const en = await (await new Client().get("/en")).text();
    const button = (html: string) => html.slice(html.indexOf('<button class="theme-toggle"'), html.indexOf("</button>", html.indexOf('<button class="theme-toggle"')) + 9);
    expect(button(en)).toBe(
      '<button class="theme-toggle" type="button" data-theme-toggle="true" aria-pressed="false" data-light-label="Switch to light mode" data-dark-label="Switch to dark mode"><span class="theme-icon" aria-hidden="true">◐</span><span class="theme-label">Theme</span></button>',
    );
    expect(en.indexOf('<button class="theme-toggle"')).toBeGreaterThan(en.indexOf('<a class="lang-toggle"'));
    const bn = await (await new Client().get("/")).text();
    expect(button(bn)).toContain('data-light-label="লাইট মোড চালু করুন" data-dark-label="ডার্ক মোড চালু করুন"');
    expect(button(bn)).toContain('<span class="theme-label">থিম</span>');
  });

  it("keeps the day look's rules in a cached file of their own, while every page carries the Theme button's look", () => {
    expect(THEME_CSS).toMatch(/^\/assets\/theme\.[0-9a-f]{10}\.css$/);
    expect(CSS).not.toContain("data-theme=light");
    expect(CSS).toContain(".theme-toggle{");
    // (that the file holds only day-look rules, so it changes nothing in the night look: scripts/lib/brand.test.mjs)
  });

  it("leaves certificates and invoices on their own paper: no switch and no script", async () => {
    const { id: studentId } = await registerStudent();
    const course = await firstCourse();
    const code = generateCertificateCode("MWH");
    await env.DB.prepare("INSERT INTO certificates (code, student_id, course_id, student_name, course_title_bn, course_title_en) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(code, studentId, course.id, "Test Student", course.title_bn, course.title_en)
      .run();
    const res = await new Client().get(`/en/certificate/${code}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Student");
    // (the site's inlined styles name the switch too: what counts is what the page shows and runs)
    expect(html.slice(html.indexOf("<body"))).not.toContain("theme-toggle");
    expect(html).not.toContain(THEME_JS);
    expect(html).not.toContain(THEME_CSS);
  });
});

describe("the night / day switch in the student app", () => {
  it("loads the same script in <head>, after the bar's colour it changes; the admin keeps its one look", () => {
    const head = APP_HTML.slice(0, APP_HTML.indexOf("</head>"));
    expect(head).toContain('<meta name="theme-color" content="#000000" />');
    expect(head).toContain('<meta name="color-scheme" content="light dark" />');
    expect(head.indexOf('<script src="/theme.js"></script>')).toBeGreaterThan(head.indexOf('name="theme-color"'));
    expect(ADMIN_HTML).not.toContain("theme.js");
  });
});
