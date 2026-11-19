import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, offerAnswered, registerStudent, useLang } from "./helpers";

/*
 * The team's side of the AI, in a real browser: a question the chatbot could not answer opens from Messages → Chatbot hand-offs (it used to
 * have no detail at all), the team writes the answer and teaches the chatbot — and the chatbot then gives that answer itself. The marketing
 * list holds the students' e-mails, and the private assistant has its own page in the menu. No AI is reached from this copy of the site:
 * the taught answer is given without one. Runs after the admin spec (the owner exists).
 */
test.describe.configure({ mode: "serial" });

let admin: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  admin = await ctx.newPage();
  await adminLogin(admin);
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(", Owner");
});
test.afterAll(async () => admin.context().close());

const QUESTION = `Can I print my certificate e2e-${Date.now().toString(36)}?`;
const ANSWER = "Yes — open My Learning → Certificates, download the PDF and print it.";

test("a chatbot hand-off opens, is answered and taught; the chatbot then answers it by itself", async () => {
  test.setTimeout(90_000);
  const asked = await admin.request.post("/api/chat", { data: { messages: [{ role: "user", content: QUESTION }], lang: "en" } });
  expect((await asked.json()).escalate).toBe(true);

  await admin.goto("/admin/messages?tab=handoffs");
  await expect(admin.getByText("Questions the chatbot could not answer.")).toBeVisible();
  await admin.getByRole("row", { name: new RegExp(QUESTION.replace(/[?]/g, "\\?")) }).click();
  const drawer = admin.getByRole("dialog", { name: "Chatbot question" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".handoff-q")).toHaveText(QUESTION);
  await expect(drawer.getByRole("switch", { name: "Teach the chatbot" })).toBeChecked();
  await drawer.getByLabel("The right answer").fill(ANSWER);

  const axe = await new AxeBuilder({ page: admin }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  await admin.getByRole("button", { name: "Save and teach the chatbot" }).click();
  await expect(admin.getByText("Saved — the chatbot has learned this answer.")).toBeVisible();
  await expect(drawer).toBeHidden();

  // asked again, the chatbot gives the team's answer word for word
  const again = await (await admin.request.post("/api/chat", { data: { messages: [{ role: "user", content: QUESTION }], lang: "en" } })).json();
  expect(again).toMatchObject({ reply: ANSWER, escalate: false, taught: true });

  // and the answer is listed with the others the chatbot was taught
  await admin.goto("/admin/chatbot");
  await expect(admin.getByRole("heading", { name: "Answers the chatbot was taught" })).toBeVisible();
  await expect(admin.getByText(QUESTION)).toBeVisible();
});

test("an answer that names a page shows a button to it in the chat window — with the page's name, not its path", async ({ browser }) => {
  const question = `Where do I find my certificate e2e-${Date.now().toString(36)}?`;
  const taught = await admin.request.post("/api/admin/chatbot/knowledge", { data: { question, answer: "Open My certificates (/app/certificates) and download the PDF.", lang: "any" } });
  expect(taught.status()).toBe(201);

  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 360, height: 760 } });
  await offerAnswered(ctx);
  await useLang(ctx, "en");
  const page = await ctx.newPage();
  await page.goto("/en");
  await page.locator(".floats summary.fab-help").click();
  await page.getByRole("group", { name: "Talk to us" }).getByRole("button", { name: /^AI assistant/ }).click();
  const dialog = page.getByRole("dialog", { name: "MAWAH Assistant" });
  await dialog.locator(".mc-in").fill(question);
  await dialog.getByRole("button", { name: "Send" }).click();
  const answer = dialog.locator(".mc-assistant").last();
  await expect(answer).toContainText("Open My certificates and download the PDF.");
  await expect(answer).not.toContainText("/app/certificates");
  const button = answer.getByRole("link", { name: /My certificates/ });
  await expect(button).toHaveAttribute("href", "/app/certificates");
  const box = await button.boundingBox();
  expect(box!.height, "big enough to tap").toBeGreaterThanOrEqual(40);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await ctx.close();
});

test("the marketing list holds a new student's e-mail, saying whether they agreed to offers", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "en-US" });
  await useLang(ctx, "en");
  const { email } = await registerStudent(await ctx.newPage());
  await ctx.close();

  await admin.goto("/admin/signups?tab=newsletter");
  await expect(admin.getByRole("tab", { name: "Marketing list" })).toHaveAttribute("aria-selected", "true");
  await admin.getByPlaceholder("Search e-mail, name or phone…").fill(email);
  const row = admin.getByRole("row", { name: new RegExp(email.replace(/[.+]/g, "\\$&")) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Student");
});

test("the private assistant has its own page in the menu", async () => {
  await admin.goto("/admin/");
  await admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "AI Assistant" }).click();
  await expect(admin).toHaveURL(/\/admin\/assistant$/);
  await expect(admin.getByRole("heading", { level: 1, name: "AI Assistant" })).toBeVisible();
  // with no AI reachable from this copy of the site it says how to set one up; with one, it offers questions to start from
  await expect(admin.getByText("The assistant needs an AI key").or(admin.getByText("Try asking:"))).toBeVisible();
});
