import { Directory, File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { fcReportFileName, fcReportHtml, type FcReport } from "@mawah/shared/foodcostReport";

/** A4 in points (72 to the inch): expo-print's own page is US Letter. */
const A4 = { width: 595, height: 842 };

/**
 * A recipe's result as a PDF file, in the website's page design (@mawah/shared/foodcostReport), and the phone's share sheet for it: save
 * it to Files or Drive, or send it on WhatsApp or by e-mail. The file is made in the app's own cache folder (no storage permission).
 */
export async function shareRecipePdf(report: FcReport, recipeName: string, dialogTitle: string): Promise<void> {
  const html = fcReportHtml(report);
  if (Platform.OS === "web") {
    // the web build used for testing: the browser's own print window, which saves a PDF
    const w = globalThis.open?.("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return;
  }
  const made = await Print.printToFileAsync({ html, ...A4 });
  const dir = new Directory(Paths.cache, "downloads");
  if (!dir.exists) dir.create({ intermediates: true });
  // the recipe's own name, so the file is easy to find again
  const target = new File(dir, fcReportFileName(recipeName));
  await new File(made.uri).move(target, { overwrite: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle });
}
