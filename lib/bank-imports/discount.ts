// Discount Bank CSV parser (Plan v4 Phase F.2).
//
// <verify-this> Discount exports CSV from the web portal under
// "פעולות בחשבון → ייצוא". Observed 2025-2026 column layout:
//   "תאריך פעולה", "תאריך ערך", "פרטים", "אסמכתא", "חובה (₪)", "זכות (₪)", "יתרה (₪)"
// The "(₪)" suffix on the amount columns is the giveaway — drop it
// before matching headers. The CSV is windows-1255 historically.

import {
  decodeMaybeUtf8,
  parseDateToIso,
  parseIlAmountToMinor,
  splitCsvLine,
  type ParsedTransactions,
  type ParsedTransactionRow,
} from "./index";

function normaliseHeader(h: string): string {
  // Strip "(₪)", asterisks, extra whitespace.
  return h
    .replace(/\(₪\)/g, "")
    .replace(/[*]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export async function parseDiscountCsv(
  buffer: Buffer,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const { text, encoding } = decodeMaybeUtf8(buffer);
  if (encoding === "windows-1255") {
    warnings.push("discount_csv: decoded as windows-1255.");
  }
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, ""));
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length && i < 40; i++) {
    const row = splitCsvLine(lines[i] ?? "").map(normaliseHeader);
    if (row.includes("חובה") && row.includes("זכות")) {
      headerIdx = i;
      headers = row;
      break;
    }
  }
  if (headerIdx < 0) {
    warnings.push(
      "discount_csv: header row not found. <verify-this:discount-csv-headers>",
    );
    return { rows: [], warnings };
  }
  // Discount labels the date column "תאריךפעולה" (no space) or "תאריך"
  // depending on export. Match either.
  const dateCol = headers.findIndex(
    (h) => h === "תאריךפעולה" || h === "תאריך",
  );
  const descCol = headers.findIndex((h) => h === "פרטים" || h === "תיאור");
  const debitCol = headers.indexOf("חובה");
  const creditCol = headers.indexOf("זכות");

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
      if (debitRaw && debitRaw !== "0" && debitRaw !== "0.00") {
        amountMinor = -parseIlAmountToMinor(debitRaw);
      } else if (creditRaw && creditRaw !== "0" && creditRaw !== "0.00") {
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
  // <verify-this:discount-csv-headers>
  return { rows, warnings };
}
