// Generic OFX parser (Plan v4 Phase F.2).
//
// Supports both OFX 1.x (SGML-ish) and OFX 2.x (well-formed XML). We
// extract STMTTRN records — each has DTPOSTED (YYYYMMDD), TRNAMT (signed
// decimal), TRNTYPE (DEBIT/CREDIT/...), NAME (counterparty), MEMO (free
// text), FITID (institution-side dedup key — we ignore, we have our own).
//
// OFX 1.x lacks closing tags; OFX 2.x is XML. A tag-pair regex scan
// handles both because we don't depend on whitespace.

import type {
  ParsedTransactions,
  ParsedTransactionRow,
} from "./index";

function matchTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m?.[1] ?? "";
}

function parseOfxDate(raw: string): string | null {
  // OFX dates: YYYYMMDD or YYYYMMDDhhmmss[.xxx][[+-]hh:mm]
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseOfxAmount(raw: string): bigint | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(-?)(\d+)(?:[.,](\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = BigInt(m[2] ?? "0");
  const fracStr = (m[3] ?? "").padEnd(2, "0").slice(0, 2);
  const frac = BigInt(fracStr);
  return sign * (whole * 100n + frac);
}

export async function parseOfx(buffer: Buffer): Promise<ParsedTransactions> {
  const warnings: string[] = [];
  const text = buffer.toString("utf8");
  if (!/OFX/i.test(text)) {
    warnings.push("ofx: file does not contain an OFX marker.");
    return { rows: [], warnings };
  }
  const rows: ParsedTransactionRow[] = [];
  const blockRx = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
  for (const match of text.matchAll(blockRx)) {
    const block = match[1] ?? "";
    const dateRaw = matchTag(block, "DTPOSTED");
    const amtRaw = matchTag(block, "TRNAMT");
    const nameRaw = matchTag(block, "NAME");
    const memoRaw = matchTag(block, "MEMO");
    const txnDate = parseOfxDate(dateRaw);
    const amountMinor = parseOfxAmount(amtRaw);
    if (txnDate === null || amountMinor === null) continue;
    const description = (memoRaw || nameRaw).trim();
    rows.push({
      txnDate,
      amountMinor,
      currency: "ILS", // OFX has a CURDEF but most IL exports default ILS
      description,
      counterparty: nameRaw.trim() || description,
    });
  }
  if (rows.length === 0) {
    warnings.push(
      "ofx: no <STMTTRN> records parsed. File may be malformed or use OFX 2.x with namespaces.",
    );
  }
  return { rows, warnings };
}
