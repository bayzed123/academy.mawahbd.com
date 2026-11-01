import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { createElement, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { authHeaders } from "../api";
import { API_URL } from "../config";
import { embedPage, type PlayerSource } from "../lib/video";
import { openPage } from "../open";
import { usePrefs } from "../prefs";
import { RADIUS } from "../theme";
import { Btn } from "../ui/Btn";
import { Icon } from "../ui/Icon";
import { Txt } from "../ui/Txt";

/** A lesson's video in a 16:9 box: the phone's own player when it can (smooth, full screen), the site's player otherwise. */
export function VideoPlayer({ source }: { source: PlayerSource }) {
  const { c, t } = usePrefs();
  const box = { width: "100%" as const, aspectRatio: 16 / 9, borderRadius: RADIUS.l, overflow: "hidden" as const, backgroundColor: "#000" };

  if (source.kind === "native") return <NativePlayer uri={source.uri} auth={source.auth} style={box} />;
  if (source.kind === "web") {
    if (Platform.OS === "web") {
      return (
        <View style={box}>
          {createElement("iframe", { src: source.uri, style: { width: "100%", height: "100%", border: 0 }, allow: "autoplay; fullscreen; encrypted-media", allowFullScreen: true })}
        </View>
      );
    }
    return (
      <View style={box}>
        <WebView
          originWhitelist={["*"]}
          source={{ html: embedPage(source.uri), baseUrl: `${API_URL}/` }}
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          style={{ backgroundColor: "#000" }}
        />
      </View>
    );
  }
  const note = source.kind === "pending" ? t("lesson.pending") : source.kind === "link" ? t("lesson.externalNote") : null;
  if (!note) return null;
  return (
    <View style={[box, { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }]}>
      <Icon name={source.kind === "pending" ? "clock" : "external"} size={30} color={c.accent} />
      <Txt v="small" color={c.text2} center>
        {note}
      </Txt>
      {source.kind === "link" ? <Btn small title={t("lesson.openLink")} icon="external" onPress={() => void openPage(source.url, c.surface)} /> : null}
    </View>
  );
}

function NativePlayer({ uri, auth, style }: { uri: string; auth: boolean; style: object }) {
  const { c, t } = usePrefs();
  const [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(
    { uri: attempt ? `${uri}${uri.includes("?") ? "&" : "?"}r=${attempt}` : uri, headers: auth ? authHeaders() : undefined, contentType: uri.endsWith(".m3u8") ? "hls" : "progressive" },
    (p) => {
      p.timeUpdateEventInterval = 0;
    },
  );
  const { status } = useEvent(player, "statusChange", { status: player.status });

  return (
    <View style={style}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />
      {status === "loading" ? (
        <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={{ position: "absolute", inset: 0, backgroundColor: c.scrim, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }}>
          <Txt v="small" color="#fff" center>
            {t("lesson.videoFailed")}
          </Txt>
          <Btn small kind="secondary" icon="refresh" title={t("common.retry")} onPress={() => setAttempt((a) => a + 1)} />
        </View>
      ) : null}
    </View>
  );
}
