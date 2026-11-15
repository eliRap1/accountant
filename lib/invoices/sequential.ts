// Sequential-number allocator for IL tax invoices.
//
// IL ITA expects an unbroken, monotonic sequence per (business, invoice
// type). Two concurrent attempts to issue must NOT both return the same
// number. We guarantee this with a Postgres advisory transaction lock
// keyed on (business_id, invoice_type) — every issuance request that
// crosses this allocator inside its transaction must wait for any
// in-flight peer on the same key.
//
// The lock is `pg_advisory_xact_lock` which auto-releases on COMMIT or
// ROLLBACK — we never need a manual unlock. This is critical: if the
// caller's transaction aborts after we incremented the JSONB counter,
// the rollback also rewinds the counter, so the next caller picks up
// the same number AND we record an audit row (outcome: rolled_back).
// Gap-free sequences are preserved.
//
// Audit semantics:
//   - On the success path, the audit row is INSERTED inside the same
//     transaction with outcome='committed'. If the caller's transaction
//     commits, audit row + invoice + counter update all commit together.
//     If the caller's transaction rolls back, audit row goes with it
//     (which is the correct outcome — there is no real "attempt" until
//     COMMIT). The companion `recordSequenceFailure` is for callers that
//     want to record an explicit attempt against the SERVICE role role
//     (i.e. outside the user transaction) when their transaction failed
//     and they want a durable note.
//   - `recordGapDetected` is for the post-commit audit job that scans
//     for gaps in already-committed sequences (cancellation + re-issue
//     scenarios).

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  invoiceSequenceAudit,
  type invoiceTypeEnum,
  type invoiceSequenceOutcomeEnum,
} from "@/db/schema/invoicing";
import {
  businesses,
  type NextInvoiceSequenceJsonb,
} from "@/db/schema/businesses";

// Pull the tx type from drizzle's transaction signature so we stay in
// sync with whatever generics the runtime client carries.
export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InvoiceType = (typeof invoiceTypeEnum.enumValues)[number];
export type InvoiceSequenceOutcome =
  (typeof invoiceSequenceOutcomeEnum.enumValues)[number];

export type NextSequenceArgs = {
  tx: DrizzleTx;
  businessId: string;
  invoiceType: InvoiceType;
  /** App user id of the operator issuing the invoice — required for audit. */
  actorUserId: string;
};

/**
 * Allocate the next sequence number for (businessId, invoiceType) within
 * the caller's transaction.
 *
 * Returns the number that should be written to `invoices.sequential_number`.
 *
 * Steps:
 *   1. `SELECT pg_advisory_xact_lock(hashtext($1 || $2))` — blocks any
 *      concurrent allocator on the same key until our tx ends.
 *   2. `SELECT next_invoice_sequence_jsonb FROM businesses WHERE id = $1
 *      FOR UPDATE` — locks the row so we can update the JSONB atomically.
 *   3. Compute `current = jsonb[invoiceType] ?? 0`, `next = current + 1`.
 *   4. `UPDATE businesses SET next_invoice_sequence_jsonb = jsonb_set(...)`
 *      writing `next` back.
 *   5. INSERT into `invoice_sequence_audit` with outcome='committed' so
 *      the audit trail commits/rolls-back together with the actual write.
 *   6. Return `next`.
 *
 * Throws if the business does not exist (caller bug — fail loudly).
 */
export async function nextInvoiceSequence(
  args: NextSequenceArgs,
): Promise<number> {
  const { tx, businessId, invoiceType, actorUserId } = args;

  // Advisory lock — auto-released on COMMIT/ROLLBACK. hashtext is stable
  // enough for collision avoidance; even if two unrelated keys collide
  // they just serialise harmlessly. We use `pg_advisory_xact_lock` (not
  // `pg_try_advisory_xact_lock`) so concurrent callers block rather than
  // race past each other.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${businessId + ":" + invoiceType}))`,
  );

  // Lock the row and read the counters JSONB.
  const rows = (await tx.execute(
    sql`SELECT next_invoice_sequence_jsonb AS jsonb FROM businesses WHERE id = ${businessId} FOR UPDATE`,
  )) as unknown as Array<{ jsonb: NextInvoiceSequenceJsonb | null }>;
  if (rows.length === 0) {
    throw new Error(
      `nextInvoiceSequence: business ${businessId} not found`,
    );
  }
  const current = rows[0]?.jsonb ?? {};
  const currentValue =
    typeof current[invoiceType] === "number" ? current[invoiceType]! : 0;
  const nextValue = currentValue + 1;

  const updatedJsonb: NextInvoiceSequenceJsonb = {
    ...current,
    [invoiceType]: nextValue,
  };

  await tx
    .update(businesses)
    .set({ nextInvoiceSequenceJsonb: updatedJsonb })
    .where(eq(businesses.id, businessId));

  // Audit row commits/rolls-back together with the caller's transaction.
  await tx.insert(invoiceSequenceAudit).values({
    businessId,
    invoiceType,
    attemptedSequence: nextValue,
    outcome: "committed",
    actorUserId,
  });

  return nextValue;
}

export type SequenceFailureArgs = {
  /** Service-role tx — write the failure note outside the failed user tx. */
  tx: DrizzleTx;
  businessId: string;
  invoiceType: InvoiceType;
  attemptedSequence: number;
  actorUserId: string;
};

/**
 * Record an out-of-band failure note when an attempted issue's tx rolled
 * back. The user-tx audit row has already rolled back with the work, so
 * this is a durable "we tried and aborted" trace written under the
 * service role — useful for ITA correspondence about gaps.
 */
export async function recordSequenceFailure(
  args: SequenceFailureArgs,
): Promise<void> {
  await args.tx.insert(invoiceSequenceAudit).values({
    businessId: args.businessId,
    invoiceType: args.invoiceType,
    attemptedSequence: args.attemptedSequence,
    outcome: "rolled_back",
    actorUserId: args.actorUserId,
  });
}

export type SequenceGapArgs = {
  tx: DrizzleTx;
  businessId: string;
  invoiceType: InvoiceType;
  attemptedSequence: number;
  actorUserId: string;
};

/**
 * Used by the post-commit audit sweep to record a discovered gap in the
 * committed sequence (e.g. an internal row with no audit trail, or a
 * cancellation + re-issue that left a numeric gap because the re-issue
 * picked a higher number). The sweep job calls this once per discovered
 * gap; UI surfaces gaps via the `invoice_sequence_audit` table.
 */
export async function recordGapDetected(args: SequenceGapArgs): Promise<void> {
  await args.tx.insert(invoiceSequenceAudit).values({
    businessId: args.businessId,
    invoiceType: args.invoiceType,
    attemptedSequence: args.attemptedSequence,
    outcome: "gap_detected",
    actorUserId: args.actorUserId,
  });
}
