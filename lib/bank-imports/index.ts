// Bank-statement import dispatcher (Plan v4 Phase F.2).
//
// Each parser returns a strict `ParsedTransactions` shape. The dispatcher
// switches on `sourceFormat` (the bank_format enum from money-flows.ts).
//
// IMPORTANT: every IL-bank parser is operating against an EXPORT FORMAT
// that the banks themselves do NOT publish a stable schema for. Each
// parser carries an internal `<verify-this>` flag documenting which
// columns / cells we assumed. The flag SHOULD be cleared once a real
// statement export has been validated by hand against a parser run.

import { parseLeumiPdf } from "./leumi";
import { parseHapoalimCsv } from "./hapoalim";
import { parseMizrahiXlsx } from "./mizrahi";
import { parseDiscountCsv } from "./discount";
import { parseOfx } from "./ofx";
import { parseGenericCsv } from "./csv";
import { parseGreenInvoiceCsv } from "./greenInvoiceCsv";

export type ParsedTransactionRow = {
  // ISO yyyy-mm-dd in the bank's reporting timezone (assumed IL/Asia
  // Jerusalem unless the file itself states otherwise).
  txnDate: string;
  // Signed amount in MINOR units (agorot for ILS). Income is positive,
  // expense is negative.
  amountMinor: bigint;
  currency: string; // ISO 4217 — almost always "ILS".
  description: string;
  // Best-effort counterparty extracted from the row.
  counterparty: string;
};

export type ParsedTransactions = {
  rows: ParsedTransactionRow[];
  periodStart?: string | undefined;
  periodEnd?: string | undefined;
  warnings: string[];
};

export type BankSourceFormat =
  | "leumi_pdf"
  | "hapoalim_csv"
  | "mizrahi_xlsx"
  | "discount_csv"
  | "ofx"
  | "csv"
  | "greeninvoice_csv";

export type ParseBankFileArgs = {
  bank: string;
  sourceFormat: BankSourceFormat;
  buffer: Buffer;
  fileName?: string;
  csvMapping?:
    | {
        dateIdx: number;
        amountIdx: number;
        creditIdx?: number;
        debitIdx?: number;
        descriptionIdx: number;
        counterpartyIdx?: number;
        dateFormat?: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
        currency?: string;
      }
    | undefined;
};

export async function parseBankFile(
  args: ParseBankFileArgs,
): Promise<ParsedTransactions> {
  switch (args.sourceFormat) {
    case "leumi_pdf":
      return parseLeumiPdf(args.buffer);
    case "hapoalim_csv":
      return parseHapoalimCsv(args.buffer);
    case "mizrahi_xlsx":
      return parseMizrahiXlsx(args.buffer);
    case "discount_csv":
      return parseDiscountCsv(args.buffer);
    case "ofx":
      return parseOfx(args.buffer);
    case "csv":
      if (!args.csvMapping) {
        throw new Error(
          "parseBankFile: generic csv requires csvMapping (column wizard output)",
        );
      }
      return parseGenericCsv(args.buffer, args.csvMapping);
    case "greeninvoice_csv":
      return parseGreenInvoiceCsv(args.buffer);
    default: {
      const _exhaustive: never = args.sourceFormat;
      void _exhaustive;
      throw new Error(`parseBankFile: unsupported format ${args.sourceFormat}`);
    }
  }
}

// Shared CSV row splitter. RFC 4180-style — handles quoted fields.
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQuote = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// IL banks export either UTF-8 (modern portals) or windows-1255 (legacy
// downloads). Try UTF-8 first; fall back to windows-1255 if the result
// contains many replacement characters.
export function decodeMaybeUtf8(buf: Buffer): {
  text: string;
  encoding: "utf-8" | "windows-1255";
} {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString("utf8"), encoding: "utf-8" };
  }
  const utf8 = buf.toString("utf8");
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements > 5) {
    try {
      const dec = new TextDecoder("windows-1255");
      return { text: dec.decode(buf), encoding: "windows-1255" };
    } catch {
      return { text: utf8, encoding: "utf-8" };
    }
  }
  return { text: utf8, encoding: "utf-8" };
}

export function parseIlAmountToMinor(raw: string): bigint {
  let s = raw.trim();
  if (s === "") throw new Error("parseIlAmountToMinor: empty");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/[₪\sILSN]/gi, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalSep = "";
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0) {
    decimalSep = ".";
  } else if (lastComma >= 0) {
    decimalSep = ",";
  }
  if (decimalSep) {
    const parts = s.split(decimalSep);
    const whole = parts.slice(0, -1).join("").replace(/[.,]/g, "");
    const frac = (parts[parts.length - 1] ?? "").padEnd(2, "0").slice(0, 2);
    if (!/^\d*$/.test(whole) || !/^\d{0,2}$/.test(frac)) {
      throw new Error(`parseIlAmountToMinor: unparseable "${raw}"`);
    }
    const v = BigInt(whole === "" ? "0" : whole) * 100n + BigInt(frac);
    return negative ? -v : v;
  }
  const cleaned = s.replace(/[.,]/g, "");
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`parseIlAmountToMinor: unparseable "${raw}"`);
  }
  const v = BigInt(cleaned) * 100n;
  return negative ? -v : v;
}

export function parseDateToIso(
  raw: string,
  format: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY" | "auto" = "auto",
): string {
  const s = raw.trim();
  if (format === "YYYY-MM-DD" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) return s;
  const parts = s.split(/[/.\-]/).map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error(`parseDateToIso: unparseable "${raw}"`);
  }
  let d: string, m: string, y: string;
  if (format === "MM/DD/YYYY") {
    [m, d, y] = parts as [string, string, string];
  } else {
    [d, m, y] = parts as [string, string, string];
  }
  if (y.length === 2) {
    const n = Number(y);
    y = (n < 50 ? 2000 + n : 1900 + n).toString();
  }
  const dd = d.padStart(2, "0");
  const mm = m.padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}
