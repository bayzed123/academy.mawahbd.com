/**
 * Pure helpers used by scripts/setup-cloudflare.mjs (kept separate so they can be unit-tested without Cloudflare).
 * They edit worker/wrangler.toml as TEXT, line by line, so comments and layout survive.
 */

export const PLACEHOLDER_D1 = "REPLACE_WITH_D1_ID";
export const PLACEHOLDER_KV = "REPLACE_WITH_KV_ID";

/** The Worker's name: the first top-level `name = "…"` (before any [table], so a rate-limit `name` cannot be mistaken for it). */
export function readWorkerName(toml) {
  return /^name\s*=\s*"([^"]+)"/m.exec(toml.split(/^\s*\[/m)[0])?.[1];
}

/** The public address the Worker is told about: the `SITE_URL` entry under [vars]. */
export function readSiteUrl(toml) {
  return /^SITE_URL\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
}

/**
 * The names the Worker is attached to as custom domains: every `{ pattern = "…", custom_domain = true }` in the top-level
 * `routes` list (comment lines are ignored). Empty when the site only lives on its free workers.dev address.
 * @returns {string[]}
 */
export function readCustomDomains(toml) {
  const head = toml.split(/^\s*\[/m)[0].replace(/^\s*#.*$/gm, "");
  const start = /^routes\s*=\s*\[/m.exec(head);
  if (!start) return [];
  const open = start.index + start[0].length - 1;
  let depth = 0;
  let close = head.length;
  for (let i = open; i < head.length; i++) {
    if (head[i] === "[") depth++;
    else if (head[i] === "]" && --depth === 0) {
      close = i;
      break;
    }
  }
  return [...head.slice(open + 1, close).matchAll(/\{[^}]*\}/g)]
    .map((m) => m[0])
    .filter((table) => /custom_domain\s*=\s*true/.test(table))
    .map((table) => /pattern\s*=\s*"([^"]+)"/.exec(table)?.[1])
    .filter(Boolean);
}

/** @returns {string[]} the placeholder IDs that are still present in the file */
export function findPlaceholders(toml) {
  return [PLACEHOLDER_D1, PLACEHOLDER_KV].filter((p) => toml.includes(p));
}

/**
 * Fills in resource IDs and (optionally) the custom domain.
 * @param {string} toml wrangler.toml contents
 * @param {{ d1Id?: string, kvId?: string, domain?: string, www?: boolean }} values  `www` also attaches www.<domain> (the Worker sends it on to <domain>)
 * @returns {{ text: string, changes: string[] }}
 */
export function patchToml(toml, { d1Id, kvId, domain, www = false } = {}) {
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
    const names = www ? [domain, `www.${domain}`] : [domain];
    const route = `routes = [${names.map((name) => `{ pattern = "${name}", custom_domain = true }`).join(", ")}]`;
    const existing = /^\s*#?\s*routes\s*=.*$/m;
    if (existing.test(text)) text = text.replace(existing, route);
    else text = text.replace(/^(workers_dev\s*=.*)$/m, `$1\n${route}`);
    changes.push(`custom domain → ${names.join(" and ")}`);
    text = text.replace(/^(SITE_URL\s*=\s*)"[^"]*"/m, `$1"https://${domain}"`);
    changes.push(`SITE_URL → https://${domain}`);
  }
  return { text, changes };
}
