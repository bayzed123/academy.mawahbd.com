import { formatDateTime, loc } from "@mawah/shared/format";
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, TextInput, View } from "react-native";
import { api, ApiError } from "../api";
import { downloadAndOpen } from "../download";
import { safeWebUrl } from "../lib/links";
import { absolute } from "../lib/video";
import { API_URL } from "../config";
import { openPage } from "../open";
import { usePrefs } from "../prefs";
import { errorKey, type StringKey } from "../strings";
import { FONT, RADIUS } from "../theme";
import type { StudentMaterial } from "../types";
import { Btn } from "../ui/Btn";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { Txt } from "../ui/Txt";
import { VideoPlayer } from "./VideoPlayer";

const KIND_ICON: Record<StudentMaterial["kind"], IconName> = { video: "video", pdf: "file", zip: "layers", book: "book", live: "live", link: "link", group: "users" };

/** The class's materials: files to download, links, live classes, videos and private groups (Admin → Materials). */
export function Materials({ items }: { items: StudentMaterial[] }) {
  const { c, t } = usePrefs();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: c.surface, borderRadius: RADIUS.m, padding: 12, borderWidth: 1, borderColor: c.line }}>
        <Icon name="shield" size={18} color={c.accent} />
        <Txt v="small" color={c.text2} style={{ flex: 1 }}>
          {t("course.materials.notice")}
        </Txt>
      </View>
      {items.map((m) => (
        <MaterialRow key={m.id} m={m} />
      ))}
    </View>
  );
}

function MaterialRow({ m }: { m: StudentMaterial }) {
  const { c, t, lang } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<{ kind: "native"; uri: string; auth: boolean } | { kind: "web"; uri: string } | null>(null);
  const [request, setRequest] = useState(m.request);
  const [profile, setProfile] = useState("");
  const [fieldError, setFieldError] = useState<StringKey | null>(null);
  const note = loc(m, "note", lang);
  const say = (key: StringKey) => (Platform.OS === "web" ? globalThis.alert?.(t(key)) : Alert.alert("", t(key)));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      say(err instanceof ApiError ? (err.code === "network" ? "err.network" : errorKey(err.code)) : "mat.failed");
    } finally {
      setBusy(false);
    }
  };

  const open = () =>
    run(async () => {
      const res = await api<{ url: string; embed_url: string | null }>(`/api/student/materials/${m.id}/open`, { method: "POST" });
      if (res.embed_url) setVideo({ kind: "web", uri: res.embed_url });
      else {
        const url = safeWebUrl(res.url);
        if (url) await openPage(url, c.surface);
      }
    });
  const play = () =>
    run(async () => {
      const res = await api<{ media_url: string }>(`/api/student/materials/${m.id}/play`, { method: "POST" });
      setVideo({ kind: "native", uri: absolute(API_URL, res.media_url), auth: true });
    });
  const download = () => run(() => downloadAndOpen(`/api/student/materials/${m.id}/download`, m.filename ?? `${loc(m, "title", lang)}.pdf`));
  const join = () =>
    run(async () => {
      if (m.ask_profile && !profile.trim()) {
        setFieldError("mat.group.err.required");
        return;
      }
      try {
        const res = await api<{ request: { status: "pending" | "approved" | "rejected" }; url: string }>(`/api/student/materials/${m.id}/join`, { method: "POST", body: { profile_url: profile.trim() } });
        setRequest(res.request);
        setFieldError(null);
        const url = safeWebUrl(res.url);
        if (url) await openPage(url, c.surface);
      } catch (err) {
        if (err instanceof ApiError && err.fields.profile_url) return setFieldError(err.fields.profile_url === "required" ? "mat.group.err.required" : "mat.group.err.facebook");
        throw err;
      }
    });

  let action: { title: string; icon: IconName; onPress: () => void } | null = null;
  if (m.delivery === "file") action = { title: t("mat.download"), icon: "download", onPress: () => void download() };
  else if (m.delivery === "play") action = { title: t("mat.watch"), icon: "play", onPress: () => void play() };
  else if (m.delivery === "embed") action = { title: t("mat.watch"), icon: "play", onPress: () => void open() };
  else if (m.delivery === "link" && m.kind === "live") action = { title: t("mat.joinLive"), icon: "live", onPress: () => void open() };
  else if (m.delivery === "link" && m.kind === "group") {
    // a group that asks for a Facebook profile opens once the owner has approved this student; any other group opens straight away
    action = request?.status === "approved" || !m.ask_profile ? { title: t("mat.group.open"), icon: "users", onPress: () => void open() } : null;
  } else if (m.delivery === "link") action = { title: t("mat.openLink"), icon: "external", onPress: () => void open() };

  const groupAsk = m.kind === "group" && m.ask_profile && request?.status !== "approved";

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
          <Icon name={KIND_ICON[m.kind]} size={20} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt v="label" numberOfLines={2}>
            {loc(m, "title", lang)}
          </Txt>
          <Txt v="small" color={c.text3}>
            {t(`mat.kind.${m.kind}` as StringKey)}
            {m.kind === "live" && m.starts_at ? ` · ${t("mat.when", { when: formatDateTime(m.starts_at, lang) })}` : ""}
          </Txt>
        </View>
      </View>
      {note ? (
        <Txt v="small" color={c.text2}>
          {note}
        </Txt>
      ) : null}
      {m.delivery === "pending" ? (
        <Txt v="small" color={c.text3}>
          {t("mat.pending")}
        </Txt>
      ) : null}
      {video ? <VideoPlayer source={video} /> : null}
      {groupAsk ? (
        <View style={{ gap: 8 }}>
          <Txt v="small" color={c.text2}>
            {request?.status === "pending" ? t("mat.group.pending") : request?.status === "rejected" ? t("mat.group.rejected") : t("mat.group.help")}
          </Txt>
          {request?.status !== "pending" ? (
            <>
              <TextInput
                value={profile}
                onChangeText={setProfile}
                placeholder="https://www.facebook.com/…"
                placeholderTextColor={c.text3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t("mat.group.profile")}
                style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: fieldError ? c.bad : c.line2, borderRadius: RADIUS.m, minHeight: 46, paddingHorizontal: 12, color: c.text, fontFamily: FONT.regular, fontSize: 15 }}
              />
              {fieldError ? (
                <Txt v="small" color={c.bad}>
                  {t(fieldError)}
                </Txt>
              ) : null}
              <Btn small title={t("mat.group.ask")} icon="users" onPress={() => void join()} loading={busy} />
            </>
          ) : null}
        </View>
      ) : null}
      {action && !video ? (
        busy ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          <Btn small kind="secondary" title={action.title} icon={action.icon} onPress={action.onPress} />
        )
      ) : null}
    </Card>
  );
}
