import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../src/lib/crypto";
import { resetSettingsCache } from "../src/lib/settings";

/** A tiny cookie-jar HTTP client that talks to the Worker exactly like a browser would. */
export class Client {
  jar = new Map<string, string>();
  readonly ip: string;

  constructor(ip?: string) {
    // every client gets its own "IP" so rate limits in one test never leak into another
    this.ip = ip ?? `10.${rand(255)}.${rand(255)}.${rand(255)}`;
  }

  async fetch(path: string, init: RequestInit & { json?: unknown; form?: Record<string, string> } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", this.ip);
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    } else if (init.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(init.form).toString();
    }
    const res = await exports.default.fetch(new Request(`https://academy.test${path}`, { ...init, headers, body, redirect: "manual" }));
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === "";
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  post(path: string, json?: unknown) {
    return this.fetch(path, { method: "POST", json: json ?? {} });
  }
  patch(path: string, json?: unknown) {
    return this.fetch(path, { method: "PATCH", json: json ?? {} });
  }
  put(path: string, json?: unknown) {
    return this.fetch(path, { method: "PUT", json: json ?? {} });
  }
  del(path: string) {
    return this.fetch(path, { method: "DELETE" });
  }
  get(path: string) {
    return this.fetch(path);
  }
}

function rand(n: number) {
  return Math.floor(Math.random() * n) + 1;
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let counter = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}${Date.now().toString(36)}${counter++}@example.test`;

export async function registerStudent(client = new Client(), overrides: Record<string, unknown> = {}) {
  const email = (overrides.email as string) ?? uniqueEmail("student");
  const res = await client.post("/api/auth/register", {
    name: "Test Student",
    email,
    password: "correct-horse-battery",
    phone: "01712345678",
    ...overrides,
  });
  const body = await json(res);
  return { client, email, res, body, id: body.student?.id as number };
}

/** Insert a staff member directly (bypasses the one-time setup flow) and return a logged-in client. */
export async function loginStaff(role: "super_admin" | "content_manager" | "support" | "viewer" = "super_admin") {
  const email = uniqueEmail(role);
  const password = "staff-password-123";
  const hash = await hashPassword(password, env.APP_SECRET);
  await env.DB.prepare("INSERT INTO staff (email, name, role, password_hash) VALUES (?, ?, ?, ?)")
    .bind(email, `Test ${role}`, role, hash)
    .run();
  const client = new Client();
  const res = await client.post("/api/admin/auth/login", { email, password });
  if (res.status !== 200) throw new Error(`staff login failed: ${res.status} ${await res.text()}`);
  return { client, email, password };
}

export async function firstCourse(slug?: string) {
  const row = slug
    ? await env.DB.prepare("SELECT * FROM courses WHERE slug = ?").bind(slug).first<any>()
    : await env.DB.prepare("SELECT * FROM courses WHERE status = 'published' ORDER BY id LIMIT 1").first<any>();
  return row as { id: number; slug: string; price: number; title_en: string; title_bn: string };
}

export function freshState() {
  resetSettingsCache();
}

export { env };
