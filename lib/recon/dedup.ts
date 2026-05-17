// Transaction deduplication helpers for the bank-import + processor-sync
// pipelines (Phase F.2 / F.4).
//
// A transaction's "fingerprint" is a SHA-256 hex digest of the canonical
// tuple `(amount_minor, txn_date rounded to UTC day, normalised counterparty)`.
// Two rows with identical fingerprints AND `|date_diff| <= 2 days` are
// treated as candidate duplicates and surfaced to the operator before
// commit. We do NOT auto-merge — a human always decides.
//
// Counterparty normalisation:
//   - Lowercase
//   - Trim outer whitespace
//   - Collapse internal whitespace runs to a single space
//   - Strip common Latin/Hebrew suffixes (LTD, INC, בע"מ) so "Acme Ltd"
//     and "Acme" fingerprint identically. (Heuristic; deliberately
//     conservative.)
//
// The Phase F task adopting this module SHOULD record the fingerprint
// alongside the transaction row (e.g. in `transactions.metadata_jsonb`)
// so re-imports stay idempotent without re-hashing.

import crypto from "node:crypto";
import { and, between, eq, sql } from "drizzle-orm";
import { transactions } from "@/db/schema/money-flows";
import type { DrizzleTx } from "@/lib/invoices/sequential";

// NOTE on currency in fingerprints: the canonical tuple now includes the
// ISO-4217 currency code. This means ₪500 (ILS) and $500 (USD) — both
// stored as 50000n amountMinor — produce different fingerprints and are
// NOT treated as duplicate candidates. The SQL candidate query is also
// filtered by currency so the index scan is bounded correctly.

export type TransactionRow = typeof transactions.$inferSelect;

const ENTITY_SUFFIX_RX = /(?:\s*(?:bm\.?|inc\.?|llc\.?|ltd\.?|בע"?מ\.?|חברה))$/u;
const SPACES_RX = /\s+/g;

/**
 * Canonical-form a counterparty string for fingerprinting + dedup match.
 * Pure function — same input -> same output forever.
 */
export function normalizeCounterparty(input: string): string {
  if (typeof input !== "string") return "";
  let s = input.trim().toLowerCase();
  // Collapse internal whitespace first, then strip trailing entity suffix.
  s = s.replace(SPACES_RX, " ");
  s = s.replace(ENTITY_SUFFIX_RX, "").trim();
  return s;
}

function toUtcDayIso(date: Date): string {
  // Round to UTC midnight. We deliberately use UTC rather than IL local
  // calendar — banks/processors report timestamps in their own zones and
  // we don't want a 23:59 IL transaction to fingerprint differently
  // from a 00:01 next-day IL transaction just because of the DST flip.
  const utc = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
    ),
  );
  return utc.toISOString().slice(0, 10);
}

export type FingerprintArgs = {
  amountMinor: bigint;
  currency: string;
  txnDate: Date;
  counterparty: string;
};

/**
 * Produce a stable SHA-256 hex digest for a transaction's canonical
 * tuple. Use this both at ingest (write to `metadata_jsonb.fingerprint`)
 * and at re-import (compare against existing rows).
 *
 * Currency is included so that ₪500 (ILS) and $500 (USD) — both stored
 * as 50000n amountMinor — produce different fingerprints and are never
 * treated as duplicates.
 */
export function fingerprintTransaction(args: FingerprintArgs): string {
  const norm = normalizeCounterparty(args.counterparty);
  const day = toUtcDayIso(args.txnDate);
  // Currency is upper-cased for normalisation so "ils" and "ILS" collide.
  const ccy = args.currency.trim().toUpperCase();
  const canonical = `${args.amountMinor.toString()}|${ccy}|${day}|${norm}`;
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type FindDuplicatesArgs = {
  businessId: string;
  amountMinor: bigint;
  currency: string;
  txnDate: Date;
  counterparty: string;
};

/**
 * Find candidate duplicates of `(amount, date ±2d, fingerprint)` for the
 * given business. Returns transaction rows ordered by date descending.
 *
 * The fingerprint match is the strict signal — date-range query is just
 * to bound the index scan. Callers presenting results to the operator
 * SHOULD display each candidate with its `description` + `source` so
 * the human can decide.
 */
export async function findDuplicates(
  tx: DrizzleTx,
  args: FindDuplicatesArgs,
): Promise<TransactionRow[]> {
  const target = fingerprintTransaction({
    amountMinor: args.amountMinor,
    currency: args.currency,
    txnDate: args.txnDate,
    counterparty: args.counterparty,
  });

  // Bound the SQL scan by amount + currency + ±2-day date range; filter
  // to exact fingerprint in JS after fetch. We don't store the fingerprint
  // in a column yet (Phase F.2 may add it), so this is the pragmatic shape.
  // Currency MUST be part of the SQL filter so that ₪500 (ILS) and $500
  // (USD) — both stored as 50000n — never collide at the candidate level.
  const lower = new Date(args.txnDate);
  lower.setUTCDate(lower.getUTCDate() - 2);
  const upper = new Date(args.txnDate);
  upper.setUTCDate(upper.getUTCDate() + 2);

  const rows = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.businessId, args.businessId),
        eq(transactions.amountMinor, args.amountMinor),
        eq(transactions.currency, args.currency.trim().toUpperCase()),
        between(
          transactions.txnDate,
          toUtcDayIso(lower),
          toUtcDayIso(upper),
        ),
      ),
    )
    .orderBy(sql`${transactions.txnDate} DESC`);

  return rows.filter((row) => {
    const rowFp = fingerprintTransaction({
      amountMinor: row.amountMinor,
      currency: row.currency,
      txnDate: new Date(`${row.txnDate}T00:00:00Z`),
      counterparty: row.description ?? "",
    });
    return rowFp === target;
  });
}
