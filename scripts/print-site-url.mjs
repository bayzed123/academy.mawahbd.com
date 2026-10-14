#!/usr/bin/env node
/**
 * Prints the address the site is told it lives at (SITE_URL in worker/wrangler.toml). The workflows use it to know what to check.
 * With --www it prints the www address instead — https://www.<host> — when that name is attached to the Worker as a custom domain
 * (so the workflows know whether to check that it sends visitors on), and nothing when it is not.
 */
import { readFileSync } from "node:fs";
import { readCustomDomains, readSiteUrl } from "./lib/toml-patch.mjs";

const toml = readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
const url = readSiteUrl(toml);
if (!url) {
  console.error("SITE_URL is missing from worker/wrangler.toml");
  process.exit(1);
}
const site = url.replace(/\/$/, "");
if (process.argv.includes("--www")) {
  const host = new URL(site).hostname;
  if (readCustomDomains(toml).includes(`www.${host}`)) console.log(`https://www.${host}`);
} else {
  console.log(site);
}
