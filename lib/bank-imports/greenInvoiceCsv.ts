// Greeninvoice CSV export parser (Plan v4 Phase F.2).
//
// Greeninvoice (greeninvoice.co.il) is the dominant IL micro-business
// bookkeeping tool we are competing against. Users migrating away export
// "תנועות בנק → ייצוא לאקסל/CSV" — the column layout is documented in
// the Greeninvoice migration helper and is stable across years:
//   "תאריך", "תיאור", "סוג תנועה", "סכום", "מטבע", "אסמכתא", "קטגוריה"
// The "סכום" column is SIGNED: negative for expenses, positive for
// income. Currency is the 3-letter ISO code.
//
// Encoding: Greeninvoice ships UTF-8 with BOM. No legacy 1255 fallback
// needed for this format — but we still pass through decodeMaybeUtf8 for
// safety (it handles BOM stripping).

import {
  decodeMaybeUtf8,
  parseDateToIso,
  parseIlAmountToMinor,
  splitCsvLine,
  type ParsedTransactions,
  type ParsedTransactionRow,
} from "./index";

export async function parseGreenInvoiceCsv(
  buffer: Buffer,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const { text } = decodeMaybeUtf8(buffer);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, ""));

  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length && i < 15; i++) {
    const row = splitCsvLine(lines[i] ?? "").map((c) => c.trim());
    if (row.includes("תאריך") && row.includes("סכום")) {
      headerIdx = i;
      headers = row;
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push(
      "greeninvoice_csv: header row not found (expected תאריך + סכום).",
    );
    return { rows: [], warnings };
  }
  const idxOf = (h: string) => headers.indexOf(h);
  const dateCol = idxOf("תאריך");
  const descCol = idxOf("תיאור");
  const amountCol = idxOf("סכום");
  const currencyCol = idxOf("מטבע");
  const refCol = idxOf("אסמכתא");

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
    const amountRaw = (cells[amountCol] ?? "").trim();
    if (!amountRaw) continue;
    let amountMinor: bigint;
    try {
      amountMinor = parseIlAmountToMinor(amountRaw);
    } catch {
      continue;
    }
    if (amountMinor === 0n) continue;
    const currency = (cells[currencyCol] ?? "ILS").trim() || "ILS";
    const description = (cells[descCol] ?? "").trim();
    const counterparty =
      description || (refCol >= 0 ? (cells[refCol] ?? "").trim() : "");
    rows.push({
      txnDate,
      amountMinor,
      currency,
      description,
      counterparty,
    });
  }
  return { rows, warnings };
}
