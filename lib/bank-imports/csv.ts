// Generic column-mapped CSV parser (Plan v4 Phase F.2).
//
// Used as the fallback when an operator has a bank export that doesn't
// match any of the named parsers. The UI's column-mapping wizard asks
// the operator to point at the date / amount / description columns; we
// receive that mapping in `csvMapping`.
//
// Two amount shapes supported:
//   - Single signed amount column (`amountIdx`)
//   - Separate debit + credit columns (`debitIdx` + `creditIdx`). When
//     both are present, AMOUNT = credit - debit.

import {
  decodeMaybeUtf8,
  parseDateToIso,
  parseIlAmountToMinor,
  splitCsvLine,
  type ParsedTransactions,
  type ParsedTransactionRow,
} from "./index";

export type CsvMapping = {
  dateIdx: number;
  amountIdx: number;
  creditIdx?: number;
  debitIdx?: number;
  descriptionIdx: number;
  counterpartyIdx?: number;
  dateFormat?: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
  currency?: string;
  // When 0 the first row is treated as data. When > 0 we skip that many
  // leading rows (typical: 1 for headers).
  skipRows?: number;
};

export async function parseGenericCsv(
  buffer: Buffer,
  mapping: CsvMapping,
): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const { text } = decodeMaybeUtf8(buffer);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, ""));
  const skip = mapping.skipRows ?? 1;
  const currency = mapping.currency ?? "ILS";
  const fmt = mapping.dateFormat ?? "auto";

  const rows: ParsedTransactionRow[] = [];
  for (let i = skip; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") continue;
    const cells = splitCsvLine(line);
    const dateRaw = cells[mapping.dateIdx] ?? "";
    if (!dateRaw.trim()) continue;
    let txnDate: string;
    try {
      txnDate = parseDateToIso(dateRaw, fmt);
    } catch {
      warnings.push(`csv: row ${i + 1} skipped — bad date "${dateRaw}"`);
      continue;
    }
    let amountMinor: bigint;
    try {
      if (mapping.debitIdx !== undefined && mapping.creditIdx !== undefined) {
        const debitRaw = (cells[mapping.debitIdx] ?? "").trim();
        const creditRaw = (cells[mapping.creditIdx] ?? "").trim();
        const debit = debitRaw ? parseIlAmountToMinor(debitRaw) : 0n;
        const credit = creditRaw ? parseIlAmountToMinor(creditRaw) : 0n;
        amountMinor = credit - debit;
      } else {
        const amtRaw = (cells[mapping.amountIdx] ?? "").trim();
        if (!amtRaw) continue;
        amountMinor = parseIlAmountToMinor(amtRaw);
      }
    } catch {
      warnings.push(`csv: row ${i + 1} skipped — bad amount`);
      continue;
    }
    if (amountMinor === 0n) continue;
    const description = (cells[mapping.descriptionIdx] ?? "").trim();
    const counterparty =
      mapping.counterpartyIdx !== undefined
        ? (cells[mapping.counterpartyIdx] ?? "").trim() || description
        : description;
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
