#!/usr/bin/env node
/** Prints the address the site is told it lives at (SITE_URL in worker/wrangler.toml). The workflows use it to know what to check. */
import { readFileSync } from "node:fs";
import { readSiteUrl } from "./lib/toml-patch.mjs";

const url = readSiteUrl(readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8"));
if (!url) {
  console.error("SITE_URL is missing from worker/wrangler.toml");
  process.exit(1);
}
console.log(url.replace(/\/$/, ""));
