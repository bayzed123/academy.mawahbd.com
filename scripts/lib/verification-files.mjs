import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Files that other services ask to be placed at the root of a website to prove it belongs to the person who asks — Meta's domain verification,
 * Google Search Console, Bing, Pinterest … They go, exactly as the service gave them, into marketing/verification/; the build turns that folder into
 * a table the Worker answers from (worker/src/routes/seo.ts), so each file opens at /<file name> with a plain 200. (A file in marketing/public/ would
 * be answered by Cloudflare's asset layer, which sends a request for "/name.html" on to "/name" first — some services do not follow that.)
 *
 * Only a plain file name with a known ending and a small size is taken: nothing else in that folder (a note, a hidden file, a picture) ever reaches the site.
 * A file that is not taken is reported by name, never silently — but it does not stop the build: an upload with an odd name must not block a deploy.
 */
export const VERIFICATION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{5,99}\.(html|txt|xml)$/;
export const VERIFICATION_MAX_BYTES = 4096;
/** answered by the website itself — a file of this name in the folder must never take their place */
const RESERVED = new Set(["robots.txt", "sitemap.xml"]);
export const isVerificationName = (name) => VERIFICATION_NAME.test(name) && !name.includes("..") && !RESERVED.has(name.toLowerCase());

/**
 * What is in `dir` (nothing when the folder does not exist): `files` is `{ "<file name>": "<exact content>" }` in name order, `skipped` the names that were
 * not taken — a wrong name, a folder, a file too big to be a verification file (hidden files and README.md are not mentioned).
 */
export function readVerificationFiles(dir) {
  const files = {};
  const skipped = [];
  if (!existsSync(dir)) return { files, skipped };
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name);
    const info = statSync(path);
    if (!isVerificationName(name) || !info.isFile() || info.size > VERIFICATION_MAX_BYTES) {
      if (!name.startsWith(".") && name.toLowerCase() !== "readme.md") skipped.push(name);
      continue;
    }
    files[name] = readFileSync(path, "utf8");
  }
  return { files, skipped };
}
