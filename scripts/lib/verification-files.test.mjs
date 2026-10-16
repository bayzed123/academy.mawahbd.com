import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isVerificationName, readVerificationFiles, VERIFICATION_MAX_BYTES } from "./verification-files.mjs";

const folder = () => mkdtempSync(join(tmpdir(), "mawah-verify-"));

test("takes the plain names the services give their files, and nothing else", () => {
  for (const ok of ["tgvr8dgfrjxjhoqzqto2mplocbx41n.html", "google1234567890abcdef.html", "BingSiteAuth.xml", "pinterest-1a2b3c.html", "yandex_4f9a8b7c.html", "verify-me.txt"]) assert.equal(isVerificationName(ok), true, ok);
  const refused = [
    "robots.txt", // answered by the website itself
    "Sitemap.xml",
    "README.md",
    ".env",
    "tiny.txt", // too short to be a token
    "verify (1).html", // a browser's name for a second download: spaces are not taken
    "a/../../etc/passwd.html",
    "name..html",
    "token.html.exe",
    "photo.png",
    "tgvr8dgfrjxjhoqzqto2mplocbx41n", // no ending
    `${"a".repeat(101)}.html`,
  ];
  for (const bad of refused) assert.equal(isVerificationName(bad), false, bad);
});

test("reads each file exactly as it is, in name order, and says which names it did not take", () => {
  const dir = folder();
  try {
    writeFileSync(join(dir, "tgvr8dgfrjxjhoqzqto2mplocbx41n.html"), "tgvr8dgfrjxjhoqzqto2mplocbx41n"); // no line break at the end: none is added
    writeFileSync(join(dir, "BingSiteAuth.xml"), '<?xml version="1.0"?>\n<users><user>ABC123</user></users>\n');
    writeFileSync(join(dir, "google0123456789abcdef.html"), "google-site-verification: google0123456789abcdef.html");
    writeFileSync(join(dir, "README.md"), "notes for people — never published");
    writeFileSync(join(dir, ".gitkeep"), "");
    writeFileSync(join(dir, "verify (1).html"), "taken twice");
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nDisallow:\n");
    mkdirSync(join(dir, "folder-named-like-a-file.html"));
    const { files, skipped } = readVerificationFiles(dir);
    assert.deepEqual(Object.keys(files), ["BingSiteAuth.xml", "google0123456789abcdef.html", "tgvr8dgfrjxjhoqzqto2mplocbx41n.html"]);
    assert.equal(files["tgvr8dgfrjxjhoqzqto2mplocbx41n.html"], "tgvr8dgfrjxjhoqzqto2mplocbx41n");
    assert.equal(files["BingSiteAuth.xml"], '<?xml version="1.0"?>\n<users><user>ABC123</user></users>\n');
    // named, so the build can say so — but not README.md or a hidden file
    assert.deepEqual(skipped, ["folder-named-like-a-file.html", "robots.txt", "verify (1).html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a folder that is not there, or is empty, is simply no files", () => {
  assert.deepEqual(readVerificationFiles(join(tmpdir(), "mawah-verify-no-such-folder")), { files: {}, skipped: [] });
  const dir = folder();
  try {
    assert.deepEqual(readVerificationFiles(dir), { files: {}, skipped: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that is too big to be one is not taken, and is reported like any other that was not taken", () => {
  const dir = folder();
  try {
    writeFileSync(join(dir, "huge-token-file.html"), "x".repeat(VERIFICATION_MAX_BYTES + 1));
    assert.deepEqual(readVerificationFiles(dir), { files: {}, skipped: ["huge-token-file.html"] });
    writeFileSync(join(dir, "huge-token-file.html"), "x".repeat(VERIFICATION_MAX_BYTES)); // exactly the limit is fine
    assert.equal(readVerificationFiles(dir).files["huge-token-file.html"]?.length, VERIFICATION_MAX_BYTES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the project's own folder can be read, and every file taken from it has content (an odd name is warned about by the build, it does not stop a deploy)", () => {
  const { files } = readVerificationFiles(resolve(fileURLToPath(new URL(".", import.meta.url)), "../../marketing/verification"));
  for (const [name, body] of Object.entries(files)) assert.ok(body.length > 0, `${name} is empty`);
});
