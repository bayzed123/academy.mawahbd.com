import { createElement, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { API_URL } from "../config";
import { openPage } from "../open";
import { usePrefs } from "../prefs";

/**
 * A lesson's notes (HTML made by the website from the owner's text). Drawn by the phone's web engine at its full height, inside the
 * screen's own scrolling, in the website's font; a link in it opens in the browser, never inside this box.
 */
export function Html({ html }: { html: string }) {
  const { c } = usePrefs();
  const [height, setHeight] = useState(80);
  const css = useMemo(
    () =>
      `@font-face{font-family:Hind;font-weight:400;src:url(/fonts/hind-bn-400.woff2) format("woff2");unicode-range:U+0980-09FE,U+200C-200D,U+25CC}` +
      `@font-face{font-family:Hind;font-weight:600;src:url(/fonts/hind-bn-600.woff2) format("woff2");unicode-range:U+0980-09FE,U+200C-200D,U+25CC}` +
      `@font-face{font-family:Hind;font-weight:400;src:url(/fonts/hind-latin-400.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}` +
      `@font-face{font-family:Hind;font-weight:600;src:url(/fonts/hind-latin-600.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}` +
      `html,body{margin:0;padding:0;background:transparent;color:${c.text2};font:15px/1.75 Hind,"Noto Sans Bengali",Roboto,sans-serif;-webkit-text-size-adjust:100%;overflow-wrap:anywhere}` +
      `h1,h2,h3,h4{color:${c.text};font-weight:600;line-height:1.4;margin:1.1em 0 .45em}h1{font-size:1.3em}h2{font-size:1.2em}h3{font-size:1.08em}` +
      `p{margin:0 0 .85em}a{color:${c.link}}strong{color:${c.text}}img{max-width:100%;height:auto;border-radius:12px}ul,ol{padding-left:1.3em;margin:0 0 .85em}li{margin:.3em 0}` +
      `blockquote{margin:0 0 .85em;padding:.2em 0 .2em 1em;border-left:3px solid ${c.accent};color:${c.text}}hr{border:0;border-top:1px solid ${c.line2};margin:1.2em 0}`,
    [c],
  );

  if (Platform.OS === "web") {
    // the web preview of the app (screenshots only): the same styles, on a plain block
    return createElement("div", { className: "lesson-notes", dangerouslySetInnerHTML: { __html: `<style>${css.replace("html,body{", ".lesson-notes{")}</style>${html}` } });
  }

  const doc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${css}</style></head><body>${html}<script>
(function(){function send(){window.ReactNativeWebView.postMessage(String(Math.ceil(document.body.getBoundingClientRect().height)))}
if(window.ResizeObserver){new ResizeObserver(send).observe(document.body)}window.addEventListener("load",send);send();})();true;</script></body></html>`;

  const allow = (req: WebViewNavigation) => {
    const url = req.url;
    if (url === "about:blank" || url.startsWith("data:") || url === `${API_URL}/` || url === API_URL) return true;
    void openPage(url, c.surface);
    return false;
  };

  return (
    <View style={{ height, minHeight: 40 }}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: doc, baseUrl: `${API_URL}/` }}
        style={{ backgroundColor: "transparent" }}
        scrollEnabled={false}
        onMessage={(e) => {
          const h = Number(e.nativeEvent.data);
          if (Number.isFinite(h) && h > 0) setHeight(h + 8);
        }}
        onShouldStartLoadWithRequest={allow}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        mixedContentMode="never"
        androidLayerType="hardware"
      />
    </View>
  );
}
