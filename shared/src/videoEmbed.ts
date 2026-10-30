/**
 * Video links that play inside the class page, in the video site's own player: YouTube (its privacy-enhanced player), Vimeo and Facebook.
 * The Worker uses this for lessons and materials; the admin uses the same rules to tell the owner, before saving, whether a link will play
 * in the page — and to play it there. Anything else opens as a link.
 *
 * The player's address is always rebuilt from checked parts (an id, Vimeo's private hash), never from the pasted text.
 */
export type VideoSite = "youtube" | "vimeo" | "facebook";

const FACEBOOK_HOST = /^(www\.|m\.|web\.|mbasic\.)?facebook\.com$/;

/**
 * A public Facebook video by its own address — a page's or a person's video (…/videos/<id>), a "watch" link (watch/?v=<id>,
 * video.php?v=<id>) or a reel (reel/<id>) — as the address Facebook's video player takes (plugins/video.php?href=…). Share links
 * (facebook.com/share/…, fb.watch/…) are not used: Facebook's player does not reliably take them, and a player showing an error is worse than
 * a link. The owner is told to copy the video's own address instead (facebookNeedsOwnAddress).
 */
function facebookEmbed(u: URL): string | null {
  if (!FACEBOOK_HOST.test(u.hostname.toLowerCase())) return null;
  const p = u.pathname;
  const v = u.searchParams.get("v");
  let href: string | null = null;
  let m: RegExpExecArray | null;
  if ((p === "/watch" || p === "/watch/" || p === "/video.php") && v && /^\d{6,20}$/.test(v)) href = `https://www.facebook.com/watch/?v=${v}`;
  else if ((m = /^\/reel\/(\d{6,20})\/?$/.exec(p))) href = `https://www.facebook.com/reel/${m[1]}`;
  // /<page>/videos/<id>/ and /<page>/videos/<title>/<id>/ (the page part is a name or a number)
  else if ((m = /^\/([A-Za-z0-9.]{1,80})\/videos\/(?:[A-Za-z0-9._-]{1,120}\/)?(\d{6,20})\/?$/.exec(p))) href = `https://www.facebook.com/${m[1]}/videos/${m[2]}/`;
  return href ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false` : null;
}

/** Which site's player a video link plays in, and the player's address — or null: the link opens as a link. */
export function videoEmbed(url: string): { site: VideoSite; src: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const fb = facebookEmbed(u);
  if (fb) return { site: "facebook", src: fb };
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) id = m[1];
    }
  }
  if (id && /^[\w-]{11}$/.test(id)) return { site: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = /^\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?(?:\/|$)/.exec(u.pathname);
    if (m) {
      // an unlisted video's link carries its private hash (vimeo.com/<id>/<hash>, or ?h=<hash>): the player needs it too
      const hash = m[2] ?? u.searchParams.get("h");
      return { site: "vimeo", src: `https://player.vimeo.com/video/${m[1]}${hash && /^[0-9a-f]{6,20}$/.test(hash) ? `?h=${hash}` : ""}` };
    }
  }
  return null;
}

/** The player's address for a YouTube / Vimeo / Facebook video link, or null (it opens as a link). */
export function externalEmbed(url: string): string | null {
  return videoEmbed(url)?.src ?? null;
}

/**
 * A Facebook address that does not play inside the page — a share link (facebook.com/share/…, fb.watch/…) or anything that is not a video's own
 * address. The admin then says how to copy the video's own address.
 */
export function facebookNeedsOwnAddress(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return (host === "fb.watch" || FACEBOOK_HOST.test(host) || host === "fb.com") && !facebookEmbed(u);
}

/** A YouTube video's own picture (its thumbnail), from the checked id; null for any other link. The home page and the admin show it. */
export function videoThumb(url: string): string | null {
  const v = videoEmbed(url);
  if (!v || v.site !== "youtube") return null;
  const id = v.src.slice(v.src.lastIndexOf("/") + 1);
  return /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/**
 * A video the public pages can play: YouTube or Vimeo. A Facebook video would need Facebook's player, which the public pages never load
 * (their policy has no door for it); it plays only in the student app and the admin. Used for the home page's videos and a class's demo.
 */
export function playsOnPublicPages(url: string): boolean {
  const v = videoEmbed(url);
  return !!v && (v.site === "youtube" || v.site === "vimeo");
}

/** The address that opens a YouTube or Vimeo video on its own site — where the picture takes a visitor without JavaScript. */
export function videoWatchUrl(url: string): string | null {
  const v = videoEmbed(url);
  if (!v) return null;
  if (v.site === "youtube") return `https://www.youtube.com/watch?v=${v.src.slice(v.src.lastIndexOf("/") + 1)}`;
  if (v.site === "vimeo") return v.src.replace("https://player.vimeo.com/video/", "https://vimeo.com/").replace("?h=", "/");
  return null;
}
