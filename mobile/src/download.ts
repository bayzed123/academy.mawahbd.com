import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { authHeaders } from "./api";
import { API_URL } from "./config";

/**
 * A class file (PDF, recipe pack …) from the website's signed-in download address: saved in the app's own folder (no storage permission
 * needed), then handed to the phone's "open with" sheet. Nothing is kept anywhere else.
 */
export async function downloadAndOpen(path: string, filename: string): Promise<void> {
  const url = `${API_URL}${path}`;
  if (Platform.OS === "web") {
    globalThis.open?.(url, "_blank", "noopener");
    return;
  }
  const dir = new Directory(Paths.cache, "downloads");
  if (!dir.exists) dir.create({ intermediates: true });
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  const target = new File(dir, safe);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(url, target, { headers: authHeaders(), idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { dialogTitle: safe });
}
