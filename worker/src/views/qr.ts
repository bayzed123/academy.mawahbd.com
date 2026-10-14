import qrcode from "qrcode-generator";

/** Render `text` as a compact inline SVG QR code (one <path>, crisp at any size). Used on certificates. */
export function qrSvg(text: string, opts: { cls?: string; label?: string } = {}): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) {
        let len = 1;
        while (c + len < n && qr.isDark(r, c + len)) len++;
        d += `M${c + quiet} ${r + quiet}h${len}v1h-${len}z`;
        c += len;
      } else c++;
    }
  }
  const size = n + quiet * 2;
  const label = (opts.label ?? "QR code").replace(/[<>&"]/g, "");
  return `<svg class="${opts.cls ?? ""}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#073b2c"/></svg>`;
}
