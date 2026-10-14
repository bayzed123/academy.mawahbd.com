/**
 * Upload hygiene. The browser-supplied Content-Type and file name are never trusted:
 * the real type is read from the file's own magic bytes, and only an allow-list of types is accepted.
 */
export interface Sniffed {
  mime: string;
  ext: string;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

export function sniffImage(b: Uint8Array): Sniffed | null {
  if (b.length < 12) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(b, 4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(b, 8, 12))) return { mime: "image/avif", ext: "avif" };
  return null;
}

const DOC_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

/** Files a lesson may carry: recipe cards (PDF), pictures, spreadsheets / docs, zips and plain text. */
export function sniffResource(b: Uint8Array, filename: string): Sniffed | null {
  const img = sniffImage(b);
  if (img) return img;
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML files and plain zips share the same signature: pick by the (sanitised) extension, default to zip
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime = DOC_BY_EXT[ext];
    return mime ? { mime, ext } : { mime: DOC_BY_EXT.zip, ext: "zip" };
  }
  // plain text / CSV / Markdown notes: only by explicit extension, and only if the first 2 KB hold no control bytes
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["txt", "csv", "md"].includes(ext)) {
    const head = b.slice(0, 2048);
    if (head.length > 0 && !head.some((v) => v === 0 || v < 9 || (v > 13 && v < 32))) {
      return ext === "csv" ? { mime: "text/csv", ext: "csv" } : { mime: "text/plain", ext: ext === "md" ? "md" : "txt" };
    }
  }
  return null;
}

/** Display file name: no paths, no control characters, bounded length, extension preserved. */
export function safeFilename(raw: string, fallback = "file"): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}
