import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  fromBnDigits,
  IMPORT_MAX_ROWS,
  languageFromText,
  mapColumns,
  methodFromText,
  normalizeAnyPhone,
  normalizeBdPhone,
  normKey,
  parseAmount,
  parseLooseDate,
  parseTable,
  splitClassCell,
  tableToRows,
  templateCsv,
} from "@mawah/shared";

/*
 * Reading a list of old students from a spreadsheet: the text becomes rows, the first line becomes columns, and every cell is read
 * the way people in Bangladesh write it (day first, Bangla digits, "৳1,500", "বিকাশ"). The Worker reads each cell again with the
 * same functions, so these are the rules both sides follow.
 */
describe("parseTable", () => {
  it("reads a plain comma file", () => {
    const t = parseTable("name,email\nRina,rina@example.com\n");
    expect(t.rows).toEqual([["name", "email"], ["Rina", "rina@example.com"]]);
    expect(t.delimiter).toBe(",");
    expect(t.truncated).toBe(false);
  });

  it("knows tabs (pasted from a sheet) and semicolons (some Excel languages)", () => {
    expect(detectDelimiter("name\temail\nA\tb")).toBe("\t");
    expect(detectDelimiter("name;email\nA;b")).toBe(";");
    expect(detectDelimiter("email")).toBe(",");
    expect(parseTable("a;b\n1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles quotes, doubled quotes, commas and line breaks inside quotes", () => {
    const t = parseTable('name,notes\n"Karim, M.","said ""hi""\nsecond line"\nX,y');
    expect(t.rows).toEqual([["name", "notes"], ["Karim, M.", 'said "hi"\nsecond line'], ["X", "y"]]);
  });

  it("copes with a byte-order mark, CRLF / CR line ends, blank lines and a trailing comma", () => {
    expect(parseTable("﻿a,b\r\n\r\n1,2,\r\n3,4\r").rows).toEqual([["a", "b"], ["1", "2", ""], ["3", "4"]]);
  });

  it("drops a line made only of separators, keeps a quote inside an unquoted value, keeps Bangla", () => {
    expect(parseTable("a,b\n,\n1,2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTable('a,b\n5" pan,x').rows).toEqual([["a", "b"], ['5" pan', "x"]]);
    expect(parseTable("নাম,ইমেইল\nরিনা,rina@example.com").rows[1]).toEqual(["রিনা", "rina@example.com"]);
  });

  it("cuts a very long list and says so", () => {
    const body = Array.from({ length: IMPORT_MAX_ROWS + 100 }, (_, i) => `n${i},e${i}@x.com`).join("\n");
    const t = parseTable("name,email\n" + body);
    expect(t.truncated).toBe(true);
    expect(t.rows.length).toBe(IMPORT_MAX_ROWS + 1); // the header and the first 1000 lines
    expect(parseTable("").rows).toEqual([]);
    expect(parseTable("\n  \n").rows).toEqual([]);
  });
});

describe("mapColumns / tableToRows", () => {
  it("finds the columns by their English or Bangla names, however they are capitalised or spaced", () => {
    const map = mapColumns(["Full Name", "E-mail", "Mobile Number", "ভাষা", "Class", "Date", "Amount Paid", "Payment Method", "Txn ID", "Remarks"]);
    expect(map.fields).toEqual(["name", "email", "phone", "language", "classes", "enrolled_on", "amount", "method", "txn_id", "notes"]);
    expect(map.ignored).toEqual([]);
    expect(mapColumns(["নাম", "ইমেইল", "ফোন", "ক্লাস", "ভর্তির তারিখ", "টাকা", "মাধ্যম"]).fields).toEqual(["name", "email", "phone", "classes", "enrolled_on", "amount", "method"]);
  });

  it("leaves out columns it does not know and a column named twice, and says which", () => {
    const map = mapColumns(["name", "email", "Favourite colour", "email", ""]);
    expect(map.fields).toEqual(["name", "email", null, null, null]);
    expect(map.ignored).toEqual(["Favourite colour", "email"]);
    expect(map.found).toEqual(["name", "email"]);
  });

  it("turns the lines into rows keyed by field, trimmed, skipping lines with nothing in a used column", () => {
    const table = parseTable("name,email,junk\n  Rina ,rina@example.com,x\n,,y\nKarim,karim@example.com,\n").rows;
    expect(tableToRows(table, mapColumns(table[0]))).toEqual([
      { name: "Rina", email: "rina@example.com" },
      { name: "Karim", email: "karim@example.com" },
    ]);
  });

  it("the downloadable template is read back by the same rules, and Excel gets a byte-order mark", () => {
    const csv = templateCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const table = parseTable(csv).rows;
    const map = mapColumns(table[0]);
    expect(map.ignored).toEqual([]);
    expect(map.found).toHaveLength(11);
    expect(tableToRows(table, map)[0]).toMatchObject({ email: "rina@example.com", classes: "beginners-baking-class", amount: "1500" });
  });
});

describe("dates", () => {
  const today = "2026-10-15";
  const ok = (s: string) => parseLooseDate(s, today);

  it("reads the day-first ways people write a date, in English or Bangla digits", () => {
    for (const s of ["2024-03-15", "2024/3/15", "2024.03.15", "15/03/2024", "15-03-2024", "15.3.2024", "15 Mar 2024", "15-Mar-2024", "15 March 2024", "March 15, 2024", "Mar 15 2024", "১৫/০৩/২০২৪", "2024-03-15 10:20", "15/03/2024 10:20:30 PM", "2024-03-15T10:20:00Z"]) {
      expect(ok(s), s).toEqual({ ok: true, date: "2024-03-15" });
    }
  });

  it("reads a spreadsheet's day number", () => {
    expect(ok("45366")).toEqual({ ok: true, date: "2024-03-15" });
  });

  it("never swaps day and month: 03/04/2024 is the 3rd of April", () => {
    expect(ok("03/04/2024")).toEqual({ ok: true, date: "2024-04-03" });
  });

  it("refuses what is not a real date, a two-digit year, the future and the distant past", () => {
    expect(ok("31/02/2024")).toEqual({ ok: false, code: "invalid_date" });
    expect(ok("2024-13-01")).toEqual({ ok: false, code: "invalid_date" });
    expect(ok("15/03/24")).toEqual({ ok: false, code: "invalid_date" });
    expect(ok("soon")).toEqual({ ok: false, code: "invalid_date" });
    expect(ok("")).toEqual({ ok: false, code: "invalid_date" });
    expect(ok("2026-10-16")).toEqual({ ok: false, code: "date_in_future" });
    expect(ok("2026-10-15")).toEqual({ ok: true, date: "2026-10-15" });
    expect(ok("1999-12-31")).toEqual({ ok: false, code: "date_too_old" });
  });
});

describe("amounts", () => {
  it("reads whole taka written the usual ways", () => {
    for (const [s, n] of [["1500", 1500], ["1,500", 1500], ["১৫০০", 1500], ["৳1500", 1500], ["1500 tk", 1500], ["Tk. 1,500", 1500], ["1500/-", 1500], ["1500 টাকা", 1500], ["1500.00", 1500], ["0", 0]] as const) {
      expect(parseAmount(s), s).toEqual({ ok: true, amount: n });
    }
  });
  it("refuses cents, minus signs, words and absurd sums", () => {
    for (const s of ["1500.50", "-100", "free", "12abc", "", "1000001", "1 500 000 000"]) expect(parseAmount(s).ok, s).toBe(false);
    expect(parseAmount("1000000")).toEqual({ ok: true, amount: 1_000_000 });
  });
});

describe("method, language, classes, phones", () => {
  it("knows how it was paid", () => {
    const cases: [string, string][] = [["bKash", "bkash"], ["BKASH personal", "bkash"], ["বিকাশ", "bkash"], ["Nagad", "nagad"], ["নগদ", "nagad"], ["Rocket", "rocket"], ["রকেট", "rocket"], ["Visa card", "card"], ["Mastercard", "card"], ["Cash in hand", "cash"], ["নগদ টাকা", "cash"], ["হাতে হাতে", "cash"], ["Bank transfer", "bank"], ["ব্যাংক", "bank"], ["something else", "other"], ["", "other"]];
    for (const [text, method] of cases) expect(methodFromText(text), text).toBe(method);
  });

  it("knows the language", () => {
    expect(languageFromText("BN")).toBe("bn");
    expect(languageFromText("Bangla")).toBe("bn");
    expect(languageFromText("বাংলা")).toBe("bn");
    expect(languageFromText("English")).toBe("en");
    expect(languageFromText("ইংরেজি")).toBe("en");
    expect(languageFromText("French")).toBeNull();
  });

  it("splits the classes cell at ; | and line breaks only (names may contain commas), and compares names without punctuation or capitals", () => {
    expect(splitClassCell("a ; b|c\nd;;")).toEqual(["a", "b", "c", "d"]);
    expect(splitClassCell("Cakes, Cupcakes & more")).toEqual(["Cakes, Cupcakes & more"]);
    expect(normKey("  Beginner’s  Baking-Class! ")).toBe("beginners baking class");
    expect(normKey("বিগিনার্স বেকিং ক্লাস")).toBe("বিগিনার্স বেকিং ক্লাস"); // Bangla vowel signs stay in the word
  });

  it("phone numbers: Bangladesh numbers in every common shape (also in Bangla digits); foreign numbers are kept for staff", () => {
    for (const s of ["01712345678", "+8801712345678", "8801712345678", "1712345678", "017-1234 5678", "০১৭১২৩৪৫৬৭৮"]) expect(normalizeBdPhone(s), s).toBe("01712345678");
    expect(normalizeBdPhone("+971501234567")).toBeNull();
    expect(normalizeAnyPhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalizeAnyPhone("00971501234567")).toBe("+971501234567");
    expect(normalizeAnyPhone("01712345678")).toBe("01712345678");
    expect(normalizeAnyPhone("12345")).toBeNull();
    expect(normalizeAnyPhone("call me")).toBeNull();
    expect(fromBnDigits("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
  });
});
