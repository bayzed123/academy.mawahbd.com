import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { underHourlyCap } from "../../../lib/cap";
import { DRIVE_LAST_KEY, driveCheck, driveConfigured, driveMedia, driveRef, driveShareEmail, forgetReadable, type DriveLast } from "../../../lib/drive";
import { notFound, ok, parseBody } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";
import { rateLimit } from "../../../middleware/ratelimit";

/**
 * Class videos kept in Google Drive. They play inside the student portal when the owner shares the video (or its folder) with the website's own
 * Google account (lib/drive.ts). From the outside there is no way to tell whether that worked — a student would just see a video that does not play —
 * so the lesson editor asks here: which address to share with, and "Check access" for the link typed in the lesson, answered in plain words.
 * The key itself never comes out: only whether one is set, and the account's e-mail address (which is not a secret: it is what Drive's Share box takes).
 */
export const drive = new Hono<AppEnv>();

drive.get("/drive", requirePerm("courses:read"), async (c) => {
  const last = await c.env.KV.get<DriveLast>(DRIVE_LAST_KEY, "json");
  return ok(c, { configured: driveConfigured(c.env), email: driveShareEmail(c.env), last });
});

const checkSchema = z.object({ url: z.string().trim().min(1, "required").max(2000, "too_long") });

drive.post("/drive/check", requirePerm("courses:write"), rateLimit("RL_FORM"), async (c) => {
  const { url } = await parseBody(c, checkSchema);
  await underHourlyCap(c, "drivecheck", 60);
  const r = await driveCheck(c.env, url);
  const ref = driveRef(url);
  // the lesson page remembers "can the account play it?" for a few minutes: the owner has probably just shared the file, so ask again
  if (ref?.kind === "file") await forgetReadable(c.env, ref.id);
  // the audit trail records that a check happened and how it ended — never the file or the link
  await audit(c, { action: "drive.checked", entity: "lesson", entityId: "", meta: { ready: r.ok, problem: r.ok ? null : r.problem } });
  const email = driveShareEmail(c.env);
  // never `{ ok: false }`: the admin client reads that as a failed request, and the plain-words explanation would never be shown
  return ok(c, r.ok ? { ready: true, ...r.data, email } : { ready: false, problem: r.problem, detail: r.detail ?? null, status: r.status ?? null, email });
});

/**
 * "Play here": the owner watches a Drive video inside the admin, exactly as a student will get it — the same Worker hands it on from Google with
 * the website's account — so it is seen to work before any student tries. Only the file a Drive link points at, only video or audio (lib/drive.ts
 * hands on nothing else), only for people who may edit classes, never kept by a cache, and with a limit of its own as for a student's video (a
 * playing video asks many times: the start, then the parts skipped to).
 */
drive.get("/drive/media", requirePerm("courses:write"), rateLimit("RL_API", (c) => `admin-media:${c.get("staff")?.id}`), async (c) => {
  const ref = driveRef(c.req.query("url") ?? "");
  if (ref?.kind !== "file") throw notFound();
  return driveMedia(c.env, ref.id, c.req.header("range") ?? null);
});
