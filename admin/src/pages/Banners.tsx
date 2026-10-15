import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BANNER_PLACEMENTS } from "@mawah/shared";
import { adm, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import type { FieldDef } from "../components/Form";
import { ResourcePage } from "../components/ResourcePage";
import { Chip, Icon, Switch, useToast } from "../components/ui";

interface Banner {
  id: number;
  placement: "hero" | "popup";
  title_bn: string;
  title_en: string;
  image_key: string | null;
  alt_en: string;
  button_en: string;
  link_url: string;
  active: number;
  starts_at: string | null;
  ends_at: string | null;
  sort: number;
  deleted_at: string | null;
}

/** Bangladesh's calendar day right now ("2026-10-20"): banners start and end on Bangladesh days, wherever the owner's laptop is. */
const dhakaToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

const stateOf = (b: Banner): "live" | "scheduled" | "ended" | "off" => {
  if (!b.active) return "off";
  const today = dhakaToday();
  if (b.starts_at && b.starts_at.slice(0, 10) > today) return "scheduled";
  if (b.ends_at && b.ends_at.slice(0, 10) < today) return "ended";
  return "live";
};

/** The on/off switch in the list: Active / Inactive without opening the form. */
function ActiveToggle({ row, canWrite }: { row: Banner; canWrite: boolean }) {
  const { t, pick, err } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const name = pick(row, "title") || row.alt_en || t("adm.banners.untitled");
  const flip = useMutation({
    mutationFn: (active: boolean) => adm(`/banners/${row.id}`, { method: "PATCH", json: { active } }),
    onSuccess: () => {
      toast(t("adm.saved"));
      void qc.invalidateQueries({ queryKey: ["/banners"] });
    },
    onError: (e) => toast(e instanceof ApiError ? err(e.code) : t("err.generic"), true),
  });
  return <Switch checked={!!row.active} disabled={!canWrite || flip.isPending} onChange={(x) => flip.mutate(x)} label={t("adm.banners.toggle", { name })} hideLabel />;
}

export function Banners() {
  const { t, pick, date } = useI18n();
  const { can } = useAuth();
  const canWrite = can("banners:write");
  const isPopup = (v: Record<string, unknown>) => v.placement === "popup";
  const fields: FieldDef[] = [
    { type: "select", key: "placement", label: t("adm.banners.placement"), hint: t("adm.banners.placementHint"), options: BANNER_PLACEMENTS.map((p) => ({ value: p, label: t(`adm.banners.p.${p}` as "adm.banners.p.hero") })) },
    { type: "image", key: "image_key", label: t("adm.banners.image"), hint: t("adm.banners.imageHint"), folder: "banners", maxWidth: 1600, wide: true },
    { type: "image", key: "mobile_image_key", label: t("adm.banners.mobileImage"), hint: t("adm.banners.mobileImageHint"), folder: "banners", maxWidth: 1000, wide: true },
    { type: "text", key: "title_bn", label: t("adm.banners.titleBn"), half: true, maxLength: 90 },
    { type: "text", key: "title_en", label: t("adm.banners.titleEn"), half: true, maxLength: 90 },
    { type: "text", key: "text_bn", label: t("adm.banners.textBn"), half: true, maxLength: 180 },
    { type: "text", key: "text_en", label: t("adm.banners.textEn"), half: true, maxLength: 180 },
    { type: "text", key: "alt_bn", label: t("adm.banners.altBn"), half: true, maxLength: 160 },
    { type: "text", key: "alt_en", label: t("adm.banners.altEn"), half: true, maxLength: 160, hint: t("adm.banners.altHint") },
    { type: "text", key: "button_bn", label: t("adm.banners.buttonBn"), half: true, maxLength: 30 },
    { type: "text", key: "button_en", label: t("adm.banners.buttonEn"), half: true, maxLength: 30, hint: t("adm.banners.buttonHint") },
    { type: "url", key: "link_url", label: t("adm.banners.link"), hint: t("adm.banners.linkHint"), maxLength: 500, placeholder: "/courses/beginners-baking-class" },
    { type: "switch", key: "new_tab", label: t("adm.banners.newTab"), half: true },
    { type: "switch", key: "active", label: t("adm.f.active"), half: true },
    { type: "section", key: "schedule", label: t("adm.banners.schedule") },
    { type: "date", key: "starts_at", label: t("adm.banners.startsAt"), half: true },
    { type: "date", key: "ends_at", label: t("adm.banners.endsAt"), half: true, hint: t("adm.banners.scheduleHint") },
    { type: "number", key: "sort", label: t("adm.f.sort"), half: true, min: 0, max: 99999, hint: t("adm.f.sortHint") },
    { type: "section", key: "popup", label: t("adm.banners.popupSection"), showIf: isPopup },
    { type: "number", key: "popup_delay_sec", label: t("adm.banners.delay"), half: true, min: 0, max: 120, hint: t("adm.banners.delayHint"), showIf: isPopup },
    { type: "number", key: "popup_repeat_days", label: t("adm.banners.repeat"), half: true, min: 0, max: 365, hint: t("adm.banners.repeatHint"), showIf: isPopup },
    { type: "select", key: "popup_pages", label: t("adm.banners.pages"), half: true, options: [{ value: "home", label: t("adm.banners.pages.home") }, { value: "all", label: t("adm.banners.pages.all") }], showIf: isPopup },
  ];
  return (
    <ResourcePage<Banner>
      title={t("adm.nav.banners")}
      sub={t("adm.banners.sub")}
      endpoint="/banners"
      perms={{ write: "banners:write" }}
      fields={fields}
      wide
      defaults={{
        placement: "hero", title_bn: "", title_en: "", text_bn: "", text_en: "", image_key: null, mobile_image_key: null, alt_bn: "", alt_en: "", button_bn: "", button_en: "",
        link_url: "", new_tab: false, active: true, starts_at: null, ends_at: null, sort: 100, popup_delay_sec: 6, popup_repeat_days: 1, popup_pages: "home",
      }}
      rowLabel={(r) => r.title_en || r.title_bn || r.alt_en || `#${r.id}`}
      defaultSort="placement"
      searchPlaceholder={t("adm.banners.search")}
      csv={false}
      trash
      filters={[{ key: "placement", label: t("adm.banners.where"), options: BANNER_PLACEMENTS.map((p) => ({ value: p, label: t(`adm.banners.p.${p}` as "adm.banners.p.hero") })) }]}
      toolbarExtra={
        <a className="btn btn-outline btn-sm" href="/" target="_blank" rel="noopener noreferrer">
          <Icon name="external" /> {t("adm.banners.preview")}
        </a>
      }
      columns={[
        {
          key: "picture",
          label: t("adm.banners.image"),
          render: (r) => (
            <span className="thumb wide sm">{r.image_key ? <img src={`/media/${r.image_key}`} alt="" loading="lazy" /> : <Icon name="image" />}</span>
          ),
        },
        {
          key: "title",
          label: t("adm.f.title"),
          render: (r) => (
            <span className="cell-title">
              <b>{pick(r, "title") || t("adm.banners.untitled")}</b>
              <small>{r.button_en ? `${r.button_en} → ${r.link_url}` : r.link_url || "—"}</small>
            </span>
          ),
        },
        { key: "placement", label: t("adm.banners.where"), sort: "placement", desktopOnly: true, render: (r) => <Chip tone={r.placement === "popup" ? "gold" : "info"}>{t(`adm.banners.p.${r.placement}` as "adm.banners.p.hero")}</Chip> },
        {
          key: "status",
          label: t("label.status"),
          render: (r) => {
            const s = stateOf(r);
            return <Chip tone={s === "live" ? "ok" : s === "scheduled" ? "gold" : "neutral"}>{t(`adm.banners.status.${s}` as "adm.banners.status.live")}</Chip>;
          },
        },
        { key: "window", label: t("adm.banners.window"), desktopOnly: true, render: (r) => (r.starts_at || r.ends_at ? `${r.starts_at ? date(r.starts_at) : "…"} → ${r.ends_at ? date(r.ends_at) : "…"}` : t("adm.banners.always")) },
        { key: "sort", label: t("adm.f.sort"), sort: "sort", desktopOnly: true },
      ]}
      rowActions={(r) => <ActiveToggle row={r} canWrite={canWrite} />}
    />
  );
}
