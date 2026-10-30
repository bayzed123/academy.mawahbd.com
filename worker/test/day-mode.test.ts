import { describe, expect, it } from "vitest";
import { THEME_BOOT, THEME_COLOR, THEME_KEY } from "@mawah/shared";
import { CSS } from "../src/generated/assets";
import { generateCertificateCode } from "../src/lib/crypto";
import { inlineHash } from "../src/middleware/security";
import { Client, env, firstCourse, registerStudent } from "./helpers";

/*
 * Night and day (the owner's fifth round). The night look stays the default; a visitor who chooses the day look with the sun / moon
 * button in the header keeps it in this browser (localStorage), and the few words of shared/src/theme.ts set it on <html> before the page
 * is drawn — so a page never flashes in the other look first, and every visitor still gets the same cached page. The policy allows that
 * one inline script by its own hash; nothing else inline runs. The admin keeps its one light look; certificates and invoices their paper.
 */
const scriptSrc = (res: Response) => (/script-src ([^;]+)/.exec(res.headers.get("content-security-policy") ?? "")?.[1] ?? "").split(" ");

describe("the night / day switch on the site", () => {
  it("sets the visitor's look in <head>, before anything is drawn, with the policy allowing exactly that script", async () => {
    const hash = await inlineHash(THEME_BOOT);
    for (const path of ["/", "/en", "/en/courses", "/en/faq", "/contact"]) {
      const res = await new Client().get(path);
      const html = await res.text();
      const head = html.slice(0, html.indexOf("</head>"));
      // the night look is what the page says first: a black bar, dark form controls…
      expect(head, path).toContain(`<meta name="theme-color" content="${THEME_COLOR.dark}"/>`);
      expect(head, path).toContain('<meta name="color-scheme" content="dark"/>');
      // …and the switch to the day look comes after them (it changes both), still inside <head>
      const boot = head.indexOf(`<script>${THEME_BOOT}</script>`);
      expect(boot, path).toBeGreaterThan(head.indexOf('<meta name="color-scheme"'));
      expect(scriptSrc(res), path).toContain(hash);
      expect(res.headers.get("content-security-policy"), path).not.toContain("unsafe-inline");
    }
  });

  it("the script only turns the day look on for a visitor who chose it, and a browser that blocks storage simply keeps the night", () => {
    expect(THEME_KEY).toBe("mawah_theme");
    expect(THEME_BOOT.startsWith("try{")).toBe(true);
    expect(THEME_BOOT.endsWith("}catch(e){}")).toBe(true);
    expect(THEME_BOOT).toContain(`if(localStorage.getItem("${THEME_KEY}")==="light")`);
    expect(THEME_BOOT).toContain('d.documentElement.setAttribute("data-theme","light")');
    expect(THEME_BOOT).toContain(`m.setAttribute("content","${THEME_COLOR.light}")`);
    expect(THEME_BOOT).toContain('c.setAttribute("content","light")');
    // nothing that reaches the network or the page's text
    expect(THEME_BOOT).not.toMatch(/fetch|XMLHttpRequest|innerHTML|document\.write|cookie/);
  });

  it("puts the switch first among the header's buttons, hidden until the site's script wires it up, named in both languages", async () => {
    const en = await (await new Client().get("/en")).text();
    expect(en).toContain('<div class="nav-actions"><button class="theme-toggle" type="button" data-theme-toggle="true" aria-pressed="false" aria-label="Day mode" title="Day mode" hidden="">');
    // a moon and a sun, drawn for the eye only (the button's name says what it does)
    const button = en.slice(en.indexOf('<button class="theme-toggle"'), en.indexOf("</button>", en.indexOf('<button class="theme-toggle"')));
    expect(button).toContain('<svg class="moon"');
    expect(button).toContain('<svg class="sun"');
    expect(button.match(/aria-hidden="true" focusable="false"/g)).toHaveLength(2);
    const bn = await (await new Client().get("/")).text();
    expect(bn).toContain('aria-label="দিনের মোড" title="দিনের মোড" hidden="">');
  });

  it("ships the day look with every page: its own tokens, under html[data-theme=light]", () => {
    expect(CSS).toContain("html[data-theme=light]{color-scheme:light;");
    expect(CSS).toMatch(/html\[data-theme=light\] \.theme-toggle \.sun\{display:block\}/);
    expect(CSS).toMatch(/html\[data-theme=light\] \.help-pop\{background:#fff;/);
    // the day look is after everything it turns around (the night rules of the same weight come first)
    expect(CSS.indexOf("html[data-theme=light]{")).toBeGreaterThan(CSS.indexOf(".site-header{"));
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
    // (the site's inlined styles name the switch too: what counts is what the page shows)
    expect(html.slice(html.indexOf("<body"))).not.toContain("theme-toggle");
    expect(html).not.toContain(THEME_BOOT);
    expect(html).not.toContain('name="color-scheme"');
  });
});

describe("the night / day switch in the student app", () => {
  const SHELL = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="theme-color" content="#000000" /><meta name="color-scheme" content="dark" /><title>Student</title></head><body><div id="root"></div></body></html>';
  const e = env as unknown as { ASSETS: { fetch: (r: Request) => Promise<Response> } };
  async function withShell<T>(fn: () => Promise<T>): Promise<T> {
    const before = e.ASSETS;
    e.ASSETS = { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html" } }) };
    try {
      return await fn();
    } finally {
      e.ASSETS = before;
    }
  }

  it("gets the same script at the end of <head>, allowed by its hash; the admin keeps its one look, with no script and no hash", async () => {
    const hash = await inlineHash(THEME_BOOT);
    await withShell(async () => {
      for (const path of ["/app/", "/app/login", "/app/certificates"]) {
        const res = await new Client().get(path);
        expect(await res.text(), path).toBe(SHELL.replace("</head>", `<script>${THEME_BOOT}</script></head>`));
        expect(scriptSrc(res), path).toContain(hash);
      }
      const admin = await new Client().get("/admin/");
      expect(await admin.text()).toBe(SHELL);
      expect(scriptSrc(admin)).not.toContain(hash);
    });
  });
});
