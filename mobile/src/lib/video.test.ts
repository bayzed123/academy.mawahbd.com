/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { absolute, embedPage, playerFor, streamHls } from "./video.ts";

const BASE = "https://mawahacademy.com";

test("a signed Cloudflare Stream player becomes its HLS address (the phone's own player)", () => {
  const embed = "https://customer-abc123.cloudflarestream.com/eyJhbGciOi.J9-x_y/iframe?preload=metadata";
  assert.equal(streamHls(embed), "https://customer-abc123.cloudflarestream.com/eyJhbGciOi.J9-x_y/manifest/video.m3u8");
  assert.deepEqual(playerFor({ video: { embed_url: embed }, external: null }, BASE), {
    kind: "native",
    uri: "https://customer-abc123.cloudflarestream.com/eyJhbGciOi.J9-x_y/manifest/video.m3u8",
    auth: false,
  });
});

test("anything that is not exactly a Stream player stays a web player", () => {
  for (const url of [
    "https://customer-abc.cloudflarestream.com.evil.test/tok/iframe",
    "http://customer-abc.cloudflarestream.com/tok/iframe",
    "https://customer-abc.cloudflarestream.com/tok/watch",
    "https://www.youtube-nocookie.com/embed/abc",
  ]) {
    assert.equal(streamHls(url), null, url);
  }
  assert.deepEqual(playerFor({ video: { embed_url: "https://player.vimeo.com/video/1" }, external: null }, BASE), { kind: "web", uri: "https://player.vimeo.com/video/1" });
});

test("a Google Drive lesson plays through the website, signed in; a free preview needs no sign-in", () => {
  const ext = { url: "", embed_url: null, pending: false };
  assert.deepEqual(playerFor({ video: null, external: { ...ext, media_url: "/api/student/lessons/7/media" } }, BASE), {
    kind: "native",
    uri: "https://mawahacademy.com/api/student/lessons/7/media",
    auth: true,
  });
  assert.deepEqual(playerFor({ video: null, external: { ...ext, media_url: "/api/preview/lessons/7/media" } }, BASE), {
    kind: "native",
    uri: "https://mawahacademy.com/api/preview/lessons/7/media",
    auth: false,
  });
});

test("pending, YouTube, other links and text lessons", () => {
  assert.deepEqual(playerFor({ video: null, external: { url: "", embed_url: null, media_url: null, pending: true } }, BASE), { kind: "pending" });
  assert.deepEqual(playerFor({ video: null, external: { url: "https://youtu.be/x", embed_url: "https://www.youtube-nocookie.com/embed/x", media_url: null, pending: false } }, BASE), {
    kind: "web",
    uri: "https://www.youtube-nocookie.com/embed/x",
  });
  assert.deepEqual(playerFor({ video: null, external: { url: "https://example.com/recipe", embed_url: null, media_url: null, pending: false } }, BASE), { kind: "link", url: "https://example.com/recipe" });
  assert.deepEqual(playerFor({ video: null, external: { url: "javascript:alert(1)", embed_url: null, media_url: null, pending: false } }, BASE), { kind: "none" });
  assert.deepEqual(playerFor({ video: null, external: null }, BASE), { kind: "none" });
});

test("addresses are joined once, and an embed page escapes its address", () => {
  assert.equal(absolute("https://mawahacademy.com/", "/media/a.webp"), "https://mawahacademy.com/media/a.webp");
  assert.equal(absolute(BASE, "https://cdn.test/x"), "https://cdn.test/x");
  const page = embedPage('https://player.test/?a=1&b="2"<x>');
  assert.match(page, /src="https:\/\/player\.test\/\?a=1&amp;b=&quot;2&quot;&lt;x>"/);
});
