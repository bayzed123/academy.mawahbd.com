import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../../env";
import { audit } from "../../../lib/audit";
import { intParam, ok, parseBody } from "../../../lib/http";
import { requirePerm } from "../../../middleware/auth";
import { rateLimit } from "../../../middleware/ratelimit";
import { driveLessons, MAX_AT_ONCE, movesBlocked, pumpMoves, queueMoves, undoMove } from "../../../services/videoMoves";

/*
 * Admin → Video speed (services/videoMoves.ts): the lessons that play from Google Drive, moved into Cloudflare Stream — one, or all of them.
 * Opening the page also moves the queue on (the copies in progress are looked at, finished ones switch their lesson to Stream, the next
 * ones start), so the owner watches it happen.
 */
export const videoMovesAdmin = new Hono<AppEnv>();

/** The website's own address, which Stream copies from (the one-time /api/video-source/… address). */
const origin = (env: AppEnv["Bindings"], reqUrl: string) => {
  try {
    return new URL(env.SITE_URL).origin;
  } catch {
    return new URL(reqUrl).origin;
  }
};

async function overview(c: { env: AppEnv["Bindings"] }) {
  return { configured: !!c.env.STREAM, at_once: MAX_AT_ONCE, blocked: await movesBlocked(c.env), lessons: await driveLessons(c.env) };
}

videoMovesAdmin.get("/video-moves", requirePerm("courses:read"), async (c) => {
  await pumpMoves(c.env, origin(c.env, c.req.url));
  return ok(c, await overview(c));
});

const moveSchema = z.union([z.object({ all: z.literal(true) }), z.object({ lessons: z.array(z.number().int().positive()).min(1).max(500) })]);

videoMovesAdmin.post("/video-moves", requirePerm("courses:write"), rateLimit("RL_FORM"), async (c) => {
  const body = await parseBody(c, moveSchema);
  const queued = await queueMoves(c.env, "all" in body ? "all" : body.lessons, c.get("staff")!.id);
  await audit(c, { action: "video.move_queued", entity: "lesson", entityId: "", meta: { queued, all: "all" in body } });
  await pumpMoves(c.env, origin(c.env, c.req.url));
  return ok(c, { queued, ...(await overview(c)) });
});

videoMovesAdmin.post("/video-moves/:id/undo", requirePerm("courses:write"), async (c) => {
  const id = intParam(c, "id");
  await undoMove(c.env, id);
  await audit(c, { action: "video.move_undone", entity: "lesson", entityId: id });
  return ok(c, await overview(c));
});
