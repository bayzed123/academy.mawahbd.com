import { useEffect, useMemo, useRef, useState } from "react";
import { bannerPreviewDoc } from "../lib/bannerPreview";
import { useI18n } from "../lib/i18n";
import type { Values } from "./Form";

/**
 * A live preview of the banner being edited, in a frame the width of a computer or of a phone. It redraws a moment after the owner stops
 * typing. The frame is the website's own markup and stylesheet (see lib/bannerPreview.ts), so what is shown is what visitors get.
 */
export function BannerPreview({ values }: { values: Values }) {
  const { t, lang } = useI18n();
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [shown, setShown] = useState<"bn" | "en">(lang);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setRoom(el.clientWidth));
    watch.observe(el);
    setRoom(el.clientWidth);
    return () => watch.disconnect();
  }, []);

  // the page's stylesheet (hashed file name): the frame loads the same one
  const stylesheet = useMemo(() => document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href ?? "", []);
  const [doc, setDoc] = useState(() => bannerPreviewDoc(values, shown, stylesheet));
  useEffect(() => {
    const id = window.setTimeout(() => setDoc(bannerPreviewDoc(values, shown, stylesheet)), 200);
    return () => window.clearTimeout(id);
  }, [values, shown, stylesheet]);

  // The frame is drawn at the width of a real screen — a computer's, a phone's — and shrunk to fit the drawer, so the page's own rules for
  // each width apply (a drawer is narrower than a computer screen). A slide is 8:3 on a computer and 5:4 on a phone; the pop-up's card is as tall as its words.
  const popup = values.placement === "popup";
  const frameW = popup ? 480 : device === "phone" ? 360 : 1100;
  const frameH = popup ? 560 : device === "phone" ? Math.round((360 * 4) / 5) + 24 : Math.round((1100 * 3) / 8) + 24;
  const scale = Math.min(1, room / frameW);

  return (
    <section className="bn-preview" aria-label={t("adm.banners.pv.title")}>
      <div className="row between">
        <h3>{t("adm.banners.pv.title")}</h3>
        <div className="row">
          <div className="segmented" role="group" aria-label={t("adm.banners.pv.title")}>
            {(["desktop", "phone"] as const).map((d) => (
              <button key={d} type="button" className={device === d ? "on" : ""} aria-pressed={device === d} onClick={() => setDevice(d)}>
                {t(`adm.banners.pv.${d}` as "adm.banners.pv.desktop")}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Language">
            {(["bn", "en"] as const).map((l) => (
              <button key={l} type="button" className={shown === l ? "on" : ""} aria-pressed={shown === l} onClick={() => setShown(l)}>
                {l === "bn" ? "বাংলা" : "English"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={box} className="bn-frame-box">
        <div className="bn-frame-fit" style={{ width: Math.round(frameW * scale), height: Math.round(frameH * scale) }}>
          <iframe title={t("adm.banners.pv.frame")} srcDoc={doc} width={frameW} height={frameH} className="bn-frame" style={{ transform: `scale(${scale})` }} />
        </div>
      </div>
      <p className="hint">{t("adm.banners.pv.note")}</p>
    </section>
  );
}
