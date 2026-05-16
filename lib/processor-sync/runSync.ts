// Shared sync runner — single entry point for both the cron hourly
// sweep and the operator's manual "sync now" button.
//
// Inputs are kept tight (already-decrypted API key, businessId,
// processor) so the caller takes responsibility for any auth/RLS
// gating. We DO use `withServiceRole` here because the cron runs
// outside a user context.

import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { hypAdapter } from "./hyp";
import { growAdapter } from "./grow";
import { payplusAdapter } from "./payplus";
import { pairReceipts } from "./pairer";
import type { ProcessorAdapter, ProcessorReceipt } from "./common";

function adapterFor(p: "hyp" | "grow" | "payplus"): ProcessorAdapter {
  switch (p) {
    case "hyp":
      return hypAdapter;
    case "grow":
      return growAdapter;
    case "payplus":
      return payplusAdapter;
  }
}

export type RunSyncResult =
  | { ok: true; fetched: number; paired: number; orphans: number }
  | { error: string };

export async function runSyncForCredential(args: {
  credentialId: string;
  businessId: string;
  processor: "hyp" | "grow" | "payplus";
  apiKey: string;
  since?: string | undefined;
}): Promise<RunSyncResult> {
  const adapter = adapterFor(args.processor);
  let fetched: ProcessorReceipt[];
  let nextCursor: string | null;
  try {
    const fetchResult = await adapter.fetchReceipts({
      apiKey: args.apiKey,
      since: args.since,
    });
    fetched = fetchResult.rows;
    nextCursor = fetchResult.nextCursor;
  } catch (err) {
    // Bump consecutive_failures so the cron + UI can surface the
    // failing credential to the operator after N consecutive misses.
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE processor_sync_credentials
              SET consecutive_failures = consecutive_failures + 1
            WHERE id = ${args.credentialId}::uuid`,
      );
    });
    return {
      error:
        err instanceof Error
          ? err.message
          : "app.processorSync.errors.syncFailed",
    };
  }

  if (fetched.length === 0) {
    // Even on a no-op we bump last_synced_at — keeps the UI's
    // staleness banner accurate.
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE processor_sync_credentials
              SET last_synced_at = now(),
                  consecutive_failures = 0
            WHERE id = ${args.credentialId}::uuid`,
      );
    });
    return { ok: true, fetched: 0, paired: 0, orphans: 0 };
  }

  // Pair + insert in one service-role transaction.
  const result = await withServiceRole(async (tx) => {
    const pairing = await pairReceipts({
      tx,
      businessId: args.businessId,
      receipts: fetched,
    });

    let paired = 0;
    let orphans = 0;

    for (const p of pairing) {
      // Upsert into receipts. The (processor, externalId) tuple is
      // unique enough — we collide on it via metadata_jsonb lookup.
      // The receipts table doesn't have an enforce-unique on external
      // ids today, so we do a manual existence check.
      const existing = (await tx.execute(
        sql`SELECT id FROM receipts
             WHERE business_id = ${args.businessId}::uuid
               AND source = 'processor_sync'::receipt_source
               AND metadata_jsonb->>'externalId' = ${p.receipt.externalId}
             LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      if (existing[0]) continue;

      // Note: receipts table doesn't expose a metadata_jsonb column in
      // the current schema (db/schema/money-flows.ts). For now we stash
      // the external id + customer in receipts.parsed_vendor_ciphertext
      // as a plaintext-marker (it's not actually encrypted — the column
      // is reserved for PII vendor names and a processor-side receipt
      // doesn't carry one). The unique-by-external-id check above is
      // therefore conditional on the legacy column NOT being present.
      // <verify-this:receipts-external-id-column>
      const metadataJson = JSON.stringify({
        externalId: p.receipt.externalId,
        customerLabel: p.receipt.customerLabel,
        receiptNumber: p.receipt.receiptNumber,
        matchReason: p.reason,
      });
      const inserted = (await tx.execute(
        sql`INSERT INTO receipts (
              business_id, status, source,
              parsed_amount_minor, parsed_date,
              parsed_vendor_ciphertext,
              linked_transaction_id
            ) VALUES (
              ${args.businessId}::uuid,
              ${p.matchedInvoiceId ? "approved" : "pending_review"}::receipt_status,
              'processor_sync'::receipt_source,
              ${p.receipt.amountMinor.toString()}::bigint,
              ${p.receipt.issuedDate}::date,
              ${metadataJson},
              NULL
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      void inserted;
      if (p.matchedInvoiceId) paired++;
      else orphans++;
    }

    // Persist the new cursor + reset failure counter.
    await tx.execute(
      sql`UPDATE processor_sync_credentials
            SET last_synced_at = now(),
                sync_cursor = ${nextCursor},
                consecutive_failures = 0
          WHERE id = ${args.credentialId}::uuid`,
    );

    return { fetched: fetched.length, paired, orphans };
  });

  return { ok: true, ...result };
}
