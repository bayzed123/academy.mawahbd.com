import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FC_REPORT_CSS, FC_REPORT_PRINT_CSS, fcReportBody, fcReportFileName, fcReportHtml, type FcReport } from "@mawah/shared/foodcostReport";
import { Client } from "./helpers";

/*
 * FoodCost's PDF (shared/src/foodcostReport.ts): the website prints it from its own page, the Android app turns it into a file. What it
 * must never do: let a recipe's name (the user's own text) become markup, leave out a figure the screen showed, let its look leak into the
 * site's page (or the site's into it), or be blocked by the site's own security rules (then it would print unstyled).
 */

const report = (over: Partial<FcReport> = {}): FcReport => ({
  lang: "en",
  docTitle: "FoodCost — Cupcakes",
  brand: "MAWAH Academy · FoodCost",
  title: "Cupcakes",
  subtitle: "Makes 12 cupcake · 7 November 2026",
  headline: [
    { label: "Cost", value: "৳37.92 / cupcake" },
    { label: "Price at a 40% margin", value: "৳65 / cupcake", tone: "accent" },
  ],
  linesHeading: "Ingredients",
  lineHeads: { n: "#", name: "Ingredient", amount: "Amount", cost: "Cost", share: "% of cost", kcal: "Calories" },
  lines: [
    { n: "1", name: "Flour", amount: "500 g", cost: "৳42.50", share: "36.2%", kcal: "1,820 kcal" },
    { n: "2", name: "Vanilla", amount: "5 g", cost: "—", share: "—", kcal: "—", note: "No price yet" },
  ],
  splitHeading: "Where the cost goes",
  split: [{ label: "Ingredients", value: "৳117.50" }],
  summaryHeading: "What it costs",
  summary: [
    { label: "The whole batch", value: "৳455" },
    { label: "Loss on each", value: "-৳5", tone: "loss" },
  ],
  foodHeading: "Calories & nutrition",
  food: [{ label: "Calories per cupcake", value: "187 kcal" }],
  notes: ["Prices: the Dhaka average."],
  footer: "Made with FoodCost on mawahacademy.com",
  ...over,
});

describe("the FoodCost PDF", () => {
  it("lays out every figure it is given, with the price and a loss marked", () => {
    const html = fcReportHtml(report());
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(html).toContain("<title>FoodCost — Cupcakes</title>");
    for (const text of ["MAWAH Academy · FoodCost", "<h1>Cupcakes</h1>", "Makes 12 cupcake · 7 November 2026", "৳37.92 / cupcake", "% of cost", "1,820 kcal", "৳117.50", "187 kcal", "Prices: the Dhaka average.", "Made with FoodCost on mawahacademy.com"])
      expect(html).toContain(text);
    expect(html).toContain('<div class="fcr-fig accent"><span>Price at a 40% margin</span><b>৳65 / cupcake</b></div>');
    expect(html).toContain('<tr class="loss"><th scope="row">Loss on each</th><td>-৳5</td></tr>');
    expect(html).toContain('<div class="fcr-note">No price yet</div>');
    // A4 on its own (the app's file), and the whole design inside the page
    expect(html).toContain("@page{size:A4;margin:14mm 13mm}");
    expect(html).toContain(FC_REPORT_CSS);
    expect(html.match(/<tbody>/g)).toHaveLength(4); // the lines, the summary, the split, the calories
  });

  it("never lets the user's own words become markup", () => {
    const html = fcReportBody(report({ title: `<script>alert(1)</script> Tom & "Jerry's"`, lines: [{ n: "1", name: "<img src=x onerror=alert(1)>", amount: "1 g", cost: "৳1", share: "100%", kcal: "—" }] }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt; Tom &amp; &quot;Jerry&#39;s&quot;</h1>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("leaves out what there is nothing for: no calories, no notes", () => {
    const html = fcReportBody(report({ food: [], notes: [] }));
    expect(html).not.toContain("Calories &amp; nutrition");
    expect(html).not.toContain("<ul>");
    expect(html.match(/<tbody>/g)).toHaveLength(3);
  });

  it("keeps its look inside .fcr, and the website's print style shows only the report, only while it is printed", () => {
    expect(fcReportBody(report({ lang: "bn" }))).toMatch(/^<div class="fcr" lang="bn">/);
    // every rule of the design is under .fcr: nothing in it can restyle the site's page
    const selectors = FC_REPORT_CSS.split("\n").map((rule) => rule.slice(0, rule.indexOf("{")));
    expect(selectors.length).toBeGreaterThan(20);
    for (const s of selectors) for (const one of s.split(",")) expect(one.trim()).toMatch(/^\.fcr(?![\w-])/);
    // the print style: hidden on the screen; when printing (and only when the page says it is printing the report) all else is hidden
    expect(FC_REPORT_PRINT_CSS).toContain("@media screen{.fcr-host{display:none!important}}");
    expect(FC_REPORT_PRINT_CSS).toContain("html.fcr-printing body>:not(.fcr-host){display:none!important}");
    expect(FC_REPORT_PRINT_CSS).toContain("html.fcr-printing,html.fcr-printing body{background:#fff!important;color:#17120f!important}");
    expect(FC_REPORT_PRINT_CSS).toContain("html.fcr-printing{color-scheme:light!important}"); // white paper, even in the site's night look
    expect(FC_REPORT_PRINT_CSS.endsWith(FC_REPORT_CSS)).toBe(true);
  });

  it("names the file after the recipe, in any script, without characters a phone or a computer refuses", () => {
    expect(fcReportFileName("Chocolate cake")).toBe("MAWAH-FoodCost-Chocolate-cake.pdf");
    expect(fcReportFileName("চকলেট কেক")).toBe("MAWAH-FoodCost-চকলেট-কেক.pdf");
    expect(fcReportFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("MAWAH-FoodCost-a-b-c-d-e-f-g-h-i-j.pdf");
    expect(fcReportFileName("  ///  ")).toBe("MAWAH-FoodCost-recipe.pdf");
    expect(fcReportFileName("x".repeat(200))).toBe(`MAWAH-FoodCost-${"x".repeat(60)}.pdf`);
  });

  it("is allowed by the student app's security rules (by the print style's fingerprint), with no 'unsafe-inline'; the admin needs none", async () => {
    const e = env as unknown as { ASSETS: { fetch: (r: Request) => Promise<Response> } };
    const before = e.ASSETS;
    e.ASSETS = { fetch: async () => new Response("<!doctype html><title>x</title>", { headers: { "Content-Type": "text/html" } }) };
    try {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FC_REPORT_PRINT_CSS)));
      const hash = `'sha256-${btoa(String.fromCharCode(...digest))}'`;
      const app = (await new Client().get("/app/foodcost/new")).headers.get("content-security-policy") ?? "";
      expect(app).toMatch(new RegExp(`style-src 'self' ${hash.replace(/[+/]/g, "\\$&")};`));
      expect(app).not.toContain("'unsafe-inline'");
      const admin = (await new Client().get("/admin/")).headers.get("content-security-policy") ?? "";
      expect(admin).toContain("style-src 'self';");
    } finally {
      e.ASSETS = before;
    }
  });
});
