/**
 * Shrink a photo in the browser before it is uploaded: scale down to `maxWidth` and re-encode as WebP.
 * A 4 MB phone photo becomes ~150 KB, which is what keeps the public pages fast. Falls back to the
 * original file if the browser cannot do it (or the result would be bigger).
 */
export async function compressImage(file: File, opts: { maxWidth: number; quality?: number }): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, opts.maxWidth / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", opts.quality ?? 0.82));
    return blob && blob.type === "image/webp" && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
