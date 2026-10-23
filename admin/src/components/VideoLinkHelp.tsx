import { useEffect, useState } from "react";
import { facebookNeedsOwnAddress, videoEmbed, type VideoSite } from "@mawah/shared";
import { useI18n } from "../lib/i18n";
import { Button, Icon } from "./ui";

const SITE_NAME: Record<VideoSite, string> = { youtube: "YouTube", vimeo: "Vimeo", facebook: "Facebook" };

/**
 * Under the link of a lesson or a class material, when it is a YouTube, Vimeo or Facebook video: that it will play inside the class page, in
 * that site's own player, and "Play here" to see it in this box — the same rules the website uses (videoEmbed). A Facebook address that is not
 * the video's own (a share link, fb.watch …) would only open on Facebook, so the owner is told what to copy instead. `asLink`: a material whose
 * type is not "Video" opens as a link, so the owner is told to choose Video.
 */
export function VideoLinkHelp({ url, asLink = false }: { url: string; asLink?: boolean }) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  // a different link is a different video: the one shown is no longer this one
  useEffect(() => setPlaying(false), [url]);

  const v = videoEmbed(url);
  if (!v) {
    if (!facebookNeedsOwnAddress(url)) return null;
    return (
      <div className="field wide notice" role="status">
        <Icon name="facebook" />
        <div>
          <b>{t("adm.vid.fbOwnTitle")}</b>
          <p>{t("adm.vid.fbOwnAddress")}</p>
        </div>
      </div>
    );
  }
  const site = SITE_NAME[v.site];
  if (asLink) {
    return (
      <div className="field wide notice" role="status">
        <Icon name="video" />
        <p>{t("adm.vid.chooseVideo", { site })}</p>
      </div>
    );
  }
  return (
    <section className="field wide video-help" aria-label={t("adm.vid.title", { site })}>
      <div className="notice ok-note">
        <Icon name="check" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{t("adm.vid.plays", { site })}</b>
          {v.site === "facebook" && <p>{t("adm.vid.fbPublic")}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <Button className="btn-outline" aria-expanded={playing} onClick={() => setPlaying(!playing)}>
              <Icon name="play" /> {playing ? t("adm.drive.playClose") : t("adm.drive.play")}
            </Button>
          </div>
          {playing && (
            <div className="drive-play">
              <iframe src={v.src} title={t("adm.vid.title", { site })} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
