/**
 * The share image (marketing/public/og-default.jpg — the picture Facebook / WhatsApp show for a link to the site) prints the site's address.
 * The address comes from SITE_URL, never written in by hand, and the picture carries it as a JPEG comment ("site=<name>"), so a test can tell
 * when the domain changed and the picture was not made again (`npm run og:image`).
 */

/** The name printed on the picture: SITE_URL's host, without "www.". */
export const shareImageHost = (siteUrl) => new URL(siteUrl).hostname.replace(/^www\./i, "").toLowerCase();

/** The comment the picture carries for the test. */
export const shareImageStamp = (siteUrl) => `site=${shareImageHost(siteUrl)}`;

/** A JPEG with `text` added as a comment (COM segment) after its APPn headers (JFIF wants APP0 straight after the start marker). */
export function withJpegComment(jpeg, text) {
  const body = Buffer.from(text, "utf8");
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) at += 2 + jpeg.readUInt16BE(at + 2);
  const segment = Buffer.alloc(4 + body.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(2 + body.length, 2);
  body.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}

/** Every comment in a JPEG's headers (up to the image data). */
export function jpegComments(jpeg) {
  const found = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1];
    if (marker === 0xda || marker === 0xd9) break; // the image data (or the end) starts: no more headers
    const length = jpeg.readUInt16BE(at + 2);
    if (marker === 0xfe) found.push(jpeg.subarray(at + 4, at + 2 + length).toString("utf8"));
    at += 2 + length;
  }
  return found;
}
