// Mizrahi Tefahot XLSX parser (Plan v4 Phase F.2).
//
// <verify-this> Mizrahi exports XLSX from "ניהול חשבון → דף חשבון →
// ייצוא ל-Excel". Observed 2025-2026 column layout (sheet 1, after the
// header row that usually starts at row 7-9):
//   A: תאריך (Date, DD/MM/YYYY)
//   B: תאריך ערך (Value date)
//   C: תיאור (Description)
//   D: סוג פעולה (Operation type — optional)
//   E: אסמכתא (Reference)
//   F: חובה (Debit, ILS major-unit)
//   G: זכות (Credit, ILS major-unit)
//   H: יתרה (Balance)
//
// XLSX parsing requires `exceljs`. We don't have it installed (Plan v4
// budget). The fallback path: if the file's first bytes are the ZIP
// magic (`PK\x03\x04`) we surface a warning and return an empty array.
// If the operator instead uploads a CSV-coerced version of the Mizrahi
// export (their portal can also serve CSV — same column layout but in
// windows-1255), we fall through to a CSV parse using the same headers.

import {
  decodeMaybeUtf8,
  parseDateToIso,
  parseIlAmountToMinor,
  splitCsvLine,
  type ParsedTransactions,
  type ParsedTransactionRow,
} from "./index";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export async function parseMizrahiXlsx(
  buffer: Buffer,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const looksLikeZip =
    buffer.length >= 4 && buffer.slice(0, 4).equals(ZIP_MAGIC);
  if (looksLikeZip) {
    warnings.push(
      "mizrahi_xlsx: XLSX parser is stubbed — install `exceljs` and implement sheet walker. <verify-this:mizrahi-xlsx-schema>",
    );
    return { rows: [], warnings };
  }
  // CSV fallback path — same column ordering as the XLSX. Operator may
  // have right-clicked "save as CSV" inside their portal.
  warnings.push(
    "mizrahi_xlsx: file is not XLSX zip — attempting CSV fallback with Mizrahi column layout. <verify-this:mizrahi-csv-fallback>",
  );
  const { text, encoding } = decodeMaybeUtf8(buffer);
  if (encoding === "windows-1255") {
    warnings.push("mizrahi_xlsx: decoded as windows-1255 (Hebrew legacy).");
  }
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, ""));
  let headerIdx = -1;
  for (let i = 0; i < lines.length && i < 40; i++) {
    const row = splitCsvLine(lines[i] ?? "");
    if (
      row.some((c) => c.trim() === "תאריך") &&
      row.some((c) => c.trim() === "חובה")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push(
      "mizrahi_xlsx: CSV fallback also failed — no header row located",
    );
    return { rows: [], warnings };
  }
  const headers = splitCsvLine(lines[headerIdx] ?? "");
  const idxOf = (h: string) => headers.findIndex((c) => c.trim() === h);
  const dateCol = idxOf("תאריך");
  const descCol = idxOf("תיאור");
  const debitCol = idxOf("חובה");
  const creditCol = idxOf("זכות");
  const rows: ParsedTransactionRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    const cells = splitCsvLine(line);
    const dateRaw = cells[dateCol] ?? "";
    if (!dateRaw.trim()) continue;
    let txnDate: string;
    try {
      txnDate = parseDateToIso(dateRaw, "DD/MM/YYYY");
    } catch {
      continue;
    }
    const debitRaw = (cells[debitCol] ?? "").trim();
    const creditRaw = (cells[creditCol] ?? "").trim();
    let amountMinor = 0n;
    try {
      if (debitRaw) {
        amountMinor = -parseIlAmountToMinor(debitRaw);
      } else if (creditRaw) {
        amountMinor = parseIlAmountToMinor(creditRaw);
      } else {
        continue;
      }
    } catch {
      continue;
    }
    const description = (cells[descCol] ?? "").trim();
    rows.push({
      txnDate,
      amountMinor,
      currency: "ILS",
      description,
      counterparty: description,
    });
  }
  // <verify-this:mizrahi-csv-fallback>
  return { rows, warnings };
}
