/** Small, dependency-free crypto helpers built on WebCrypto (available in Workers). */

const encoder = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** URL-safe random token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return b64urlEncode(randomBytes(bytes));
}

/** Crockford base32 without I, L, O, U — unambiguous when read aloud or retyped from a certificate. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const BASE32_LOWER = "abcdefghijklmnopqrstuvwxyz234567";

/** Uniform random string from `alphabet` using rejection sampling (no modulo bias). */
export function randomString(length: number, alphabet: string = CROCKFORD): string {
  const n = alphabet.length;
  const limit = Math.floor(256 / n) * n;
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      if (b < limit) {
        out += alphabet[b % n];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** `length` random decimal digits, each uniform (rejection sampling: no modulo bias) — a one-time code a person types. */
export function randomDigits(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      // 250 = 25 × 10: bytes from 250 up would make the low digits more likely
      if (b < 250) {
        out += String(b % 10);
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** MWH-XXXX-XXXX-XXXX — 12 symbols x 5 bits = 60 bits of entropy (unguessable, rate-limited lookup). */
export function generateCertificateCode(prefix: string): string {
  const body = randomString(12);
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/** Normalise user input of a certificate code: uppercase, fix look-alike letters, re-insert dashes. */
export function normalizeCertificateCode(input: string, prefix: string): string | null {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const p = prefix.toUpperCase();
  if (!raw.startsWith(p)) return null;
  const body = raw
    .slice(p.length)
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(body)) return null;
  return `${p}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/** Public order id handed to payment gateways (100 bits). */
export function generatePublicOrderId(): string {
  return randomString(20, BASE32_LOWER);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmacKey(secret: string, usage: "sign" | "verify" = "sign") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message));
  return toHex(sig);
}

/** Constant-time string comparison (length is not secret here). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/* ------------------------------------------------------------------------------------------------
 * Password hashing
 *   PBKDF2-HMAC-SHA256, 100 000 iterations (the maximum the Workers runtime allows), per-user random
 *   salt, plus a server-side pepper: the password is first passed through HMAC-SHA256(APP_SECRET, pw),
 *   so a leaked database alone is not enough to run an offline guessing attack.
 *   Stored format:  pbkdf2-sha256$<iterations>$<salt>$<hash>
 * ---------------------------------------------------------------------------------------------- */
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const peppered = await crypto.subtle.sign("HMAC", await hmacKey(pepper), encoder.encode(password));
  const base = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, pepper, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

/** `peppers` = [current, previous?] so APP_SECRET can be rotated without locking everyone out. */
export async function verifyPassword(password: string, stored: string, peppers: string[]): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 1_000_000) return false;
  const salt = b64urlDecode(parts[2]);
  const expected = parts[3];
  for (const pepper of peppers) {
    const actual = b64urlEncode(await pbkdf2(password, pepper, salt, iterations));
    if (timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

/** True when a stored hash was made with weaker parameters or an older pepper and should be upgraded. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  return parts.length !== 4 || Number(parts[1]) < PBKDF2_ITERATIONS;
}

/** A hash to verify against when the account does not exist, so login timing does not reveal who has an account. */
export const DUMMY_HASH =
  "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/* ------------------------------------------------------------------------------------------------
 * Encrypting small secrets at rest (e.g. an AI provider key saved from the admin screen).
 *   AES-256-GCM, random 96-bit nonce, key = HKDF-SHA256(APP_SECRET, info = "mawah/secret-box/v1").
 *   Stored format:  v1.<nonce>.<ciphertext>   —  decrypt() tries APP_SECRET then APP_SECRET_PREVIOUS (rotation).
 * ---------------------------------------------------------------------------------------------- */
async function boxKey(secret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("mawah-academy"), info: encoder.encode("mawah/secret-box/v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await boxKey(secret, "encrypt"), encoder.encode(plain));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(blob: string, secrets: string[]): Promise<string | null> {
  const [version, iv, ct] = blob.split(".");
  if (version !== "v1" || !iv || !ct) return null;
  for (const secret of secrets) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(iv) as BufferSource }, await boxKey(secret, "decrypt"), b64urlDecode(ct) as BufferSource);
      return new TextDecoder().decode(plain);
    } catch {
      /* wrong key: try the next one */
    }
  }
  return null;
}
