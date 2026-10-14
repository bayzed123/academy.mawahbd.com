/**
 * Shrinks a phone screenshot or photo before it is sent: the longest side to 1600 px, JPEG at 82 %. A 4 MB camera photo becomes a few
 * hundred KB, which is faster on a mobile connection and far below the server's cap. If anything goes wrong (an unusual format the
 * browser cannot draw) or the result would not be smaller, the original file is sent unchanged.
 */
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size < file.size) return blob;
  } catch {
    /* send the original */
  }
  return file;
}
