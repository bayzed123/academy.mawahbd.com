/**
 * Pure helpers used by scripts/setup-cloudflare.mjs (kept separate so they can be unit-tested without Cloudflare).
 * They edit worker/wrangler.toml as TEXT, line by line, so comments and layout survive.
 */

export const PLACEHOLDER_D1 = "REPLACE_WITH_D1_ID";
export const PLACEHOLDER_KV = "REPLACE_WITH_KV_ID";

/** @returns {string[]} the placeholder IDs that are still present in the file */
export function findPlaceholders(toml) {
  return [PLACEHOLDER_D1, PLACEHOLDER_KV].filter((p) => toml.includes(p));
}

/**
 * Fills in resource IDs and (optionally) the custom domain.
 * @param {string} toml wrangler.toml contents
 * @param {{ d1Id?: string, kvId?: string, domain?: string }} values
 * @returns {{ text: string, changes: string[] }}
 */
export function patchToml(toml, { d1Id, kvId, domain } = {}) {
  const changes = [];
  let text = toml;

  if (d1Id && text.includes(PLACEHOLDER_D1)) {
    text = text.replace(PLACEHOLDER_D1, d1Id);
    changes.push(`D1 database_id → ${d1Id}`);
  }
  if (kvId && text.includes(PLACEHOLDER_KV)) {
    text = text.replace(PLACEHOLDER_KV, kvId);
    changes.push(`KV namespace id → ${kvId}`);
  }
  if (domain) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) throw new Error(`"${domain}" does not look like a host name`);
    const route = `routes = [{ pattern = "${domain}", custom_domain = true }]`;
    const existing = /^\s*#?\s*routes\s*=.*$/m;
    if (existing.test(text)) text = text.replace(existing, route);
    else text = text.replace(/^(workers_dev\s*=.*)$/m, `$1\n${route}`);
    changes.push(`custom domain → ${domain}`);
    text = text.replace(/^(SITE_URL\s*=\s*)"[^"]*"/m, `$1"https://${domain}"`);
    changes.push(`SITE_URL → https://${domain}`);
  }
  return { text, changes };
}
