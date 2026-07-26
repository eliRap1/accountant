// Hapoalim CSV parser (Plan v4 Phase F.2).
//
// <verify-this> Hapoalim's web portal exposes a CSV export under
// "פעולות בחשבון → ייצוא לאקסל". The 2025-2026 layout observed in IL
// fintech community references is:
//   Row 1: title row ("ריכוז פעולות עו"ש" + period text)
//   Row 2: blank
//   Row 3: column headers, in this order:
//     "תאריך", "תאריך ערך", "תיאור הפעולה", "אסמכתא", "חובה", "זכות", "יתרה"
//   Row 4+: data rows. Amounts are major-unit ILS with thousands "," and
//   decimal "." — e.g. "1,234.56". Debit/Credit are on separate columns;
//   exactly one is populated per row.
//
// Encoding: Hapoalim's CSV is windows-1255 historically; the web export
// added a UTF-8 BOM around 2024. decodeMaybeUtf8 handles both.
//
// We deliberately do NOT trust the header row ordering — we MATCH on the
// Hebrew header strings so a column reorder in the future doesn't
// silently flip debit/credit signs.

import {
  decodeMaybeUtf8,
  parseDateToIso,
  parseIlAmountToMinor,
  splitCsvLine,
  type ParsedTransactions,
  type ParsedTransactionRow,
} from "./index";

const HEADER_DATE = ["תאריך"];
const HEADER_DESC = ["תיאור הפעולה", "תיאור"];
const HEADER_REF = ["אסמכתא"];
const HEADER_DEBIT = ["חובה"];
const HEADER_CREDIT = ["זכות"];

function findHeaderIdx(
  headers: string[],
  candidates: string[],
): number {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.trim() === c);
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function parseHapoalimCsv(
  buffer: Buffer,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const { text, encoding } = decodeMaybeUtf8(buffer);
  if (encoding === "windows-1255") {
    warnings.push(
      "hapoalim_csv: file was decoded as windows-1255 (legacy Hebrew encoding).",
    );
  }
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, ""));
  // Locate the header row by scanning for "תאריך" + "חובה" + "זכות".
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length && i < 40; i++) {
    const row = splitCsvLine(lines[i] ?? "");
    if (
      findHeaderIdx(row, HEADER_DATE) >= 0 &&
      findHeaderIdx(row, HEADER_DEBIT) >= 0 &&
      findHeaderIdx(row, HEADER_CREDIT) >= 0
    ) {
      headerIdx = i;
      headers = row;
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push(
      "hapoalim_csv: header row not found — expected תאריך + חובה + זכות columns. <verify-this:hapoalim-csv-headers>",
    );
    return { rows: [], warnings };
  }
  const dateCol = findHeaderIdx(headers, HEADER_DATE);
  const descCol = findHeaderIdx(headers, HEADER_DESC);
  const refCol = findHeaderIdx(headers, HEADER_REF);
  const debitCol = findHeaderIdx(headers, HEADER_DEBIT);
  const creditCol = findHeaderIdx(headers, HEADER_CREDIT);

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
      warnings.push(
        `hapoalim_csv: row ${i + 1} skipped — could not parse date "${dateRaw}"`,
      );
      continue;
    }
    const debitRaw = (cells[debitCol] ?? "").trim();
    const creditRaw = (cells[creditCol] ?? "").trim();
    let amountMinor = 0n;
    try {
      if (debitRaw && debitRaw !== "0" && debitRaw !== "0.00") {
        amountMinor = -parseIlAmountToMinor(debitRaw);
      } else if (creditRaw && creditRaw !== "0" && creditRaw !== "0.00") {
        amountMinor = parseIlAmountToMinor(creditRaw);
      } else {
        continue; // zero-amount row, skip silently
      }
    } catch {
      warnings.push(
        `hapoalim_csv: row ${i + 1} skipped — could not parse amount`,
      );
      continue;
    }
    const description = (cells[descCol] ?? "").trim();
    const counterparty =
      description || (refCol >= 0 ? (cells[refCol] ?? "").trim() : "");
    rows.push({
      txnDate,
      amountMinor,
      currency: "ILS",
      description,
      counterparty,
    });
  }
  // <verify-this:hapoalim-csv-headers>
  return { rows, warnings };
}
