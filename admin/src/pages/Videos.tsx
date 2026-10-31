import { useMutation, useQueryClient } from "@tanstack/react-query";
import { videoEmbed, videoThumb } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { Chip, Icon, Switch, useToast } from "../components/ui";
import { VideoLinkHelp } from "../components/VideoLinkHelp";

interface Video {
  id: number;
  url: string;
  title_bn: string;
  title_en: string;
  active: number;
  sort: number;
  deleted_at: string | null;
}

/** The on/off switch in the list: on the home page or not, without opening the form. */
function ActiveToggle({ row, canWrite }: { row: Video; canWrite: boolean }) {
  const { t, pick, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const name = pick(row, "title") || row.url;
  const flip = useMutation({
    mutationFn: (active: boolean) => adm(`/videos/${row.id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/videos"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  return <Switch checked={!!row.active} disabled={!canWrite || flip.isPending} onChange={(x) => flip.mutate(x)} label={t("adm.videos.toggle", { name })} hideLabel />;
}

/**
 * Admin → Home videos: YouTube or Vimeo videos for the home page, each with its own on/off switch. The page shows the ones switched on, in
 * their order, and plays them right there in the video site's own player. With none switched on, the section is not shown at all.
 */
export function Videos() {
  const { t, pick, lang } = useI18n();
  const { can } = useAuth();
  const canWrite = can("banners:write");
  const fields: FieldDef[] = [
    { type: "url", key: "url", label: t("adm.videos.url"), hint: t("adm.videos.urlHint"), required: true, maxLength: 300, placeholder: "https://www.youtube.com/watch?v=…" },
    { type: "text", key: "title_bn", label: t("adm.videos.titleBn"), maxLength: 120 },
    { type: "text", key: "title_en", label: t("adm.videos.titleEn"), maxLength: 120, hint: t("adm.videos.titleHint") },
    { type: "switch", key: "active", label: t("adm.videos.active"), half: true },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999, hint: t("adm.f.sortHint") },
  ];
  return (
    <ResourcePage<Video>
      title={t("adm.nav.videos")}
      sub={t("adm.videos.sub")}
      endpoint="/videos"
      perms={{ write: "banners:write" }}
      fields={fields}
      defaults={{ url: "", title_bn: "", title_en: "", active: true, sort: 100 }}
      rowLabel={(r) => r.title_en || r.title_bn || r.url}
      defaultSort="sort"
      searchPlaceholder={t("adm.videos.search")}
      csv={false}
      trash
      preview={(values) => {
        // nothing to show for an empty or unknown address (no empty box above the form); a Facebook or Drive video is explained
        return <VideoLinkHelp url={String(values.url ?? "")} publicPage />;
      }}
      filters={[{ key: "active", label: t("label.status"), options: [{ value: "1", label: t("adm.videos.on") }, { value: "0", label: t("adm.videos.off") }] }]}
      toolbarExtra={
        <a className="btn btn-outline btn-sm" href={lang === "en" ? "/en#videos" : "/#videos"} target="_blank" rel="noopener noreferrer">
          <Icon name="external" /> {t("adm.videos.preview")}
        </a>
      }
      columns={[
        {
          key: "video",
          label: t("adm.videos.video"),
          render: (r) => {
            const thumb = videoThumb(r.url);
            const site = videoEmbed(r.url)?.site;
            return (
              <span className="vid-cell">
                {thumb ? <img src={thumb} alt="" width={96} height={54} loading="lazy" /> : <span className="vid-cell-ph"><Icon name="video" /></span>}
                <span className="cell-title">
                  <b>{pick(r, "title") || t("adm.videos.untitled")}</b>
                  <small>{site === "vimeo" ? "Vimeo" : "YouTube"}</small>
                </span>
              </span>
            );
          },
        },
        { key: "status", label: t("label.status"), render: (r) => <Chip tone={r.active ? "ok" : "neutral"}>{t(r.active ? "adm.videos.on" : "adm.videos.off")}</Chip> },
        { key: "sort", label: t("adm.f.sort"), sort: "sort", desktopOnly: true },
      ]}
      rowActions={(r) => <ActiveToggle row={r} canWrite={canWrite} />}
    />
  );
}
