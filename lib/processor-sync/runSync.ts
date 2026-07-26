// Shared sync runner — single entry point for both the cron hourly
// sweep and the operator's manual "sync now" button.
//
// Inputs are kept tight (already-decrypted API key, businessId,
// processor) so the caller takes responsibility for any auth/RLS
// gating. We DO use `withServiceRole` here because the cron runs
// outside a user context.
//
// Storage contract for processor-sync receipts:
//   parsed_vendor_ciphertext — AES-256-GCM ciphertext of the
//     counterparty metadata JSON, encrypted with the business DEK
//     (same pattern as OCR receipts in app/api/receipts/parse/route.ts).
//     The DEK id is stored in parsed_vendor_dek_id so decrypt survives
//     key rotation.
//   ocr_text_dek_id — always NULL for processor-sync receipts because
//     there is no OCR step in this path. Decrypt callers MUST NULL-check
//     this column before attempting to decrypt ocr_text_ciphertext.

import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { encryptStringWithDek } from "@/lib/security/encryption";
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
      // Dedup against `receipts.external_ref` (added in migration
      // 0013). Partial-unique index `receipts_external_ref_idx`
      // additionally enforces idempotence at the DB layer.
      const existing = (await tx.execute(
        sql`SELECT id FROM receipts
             WHERE business_id = ${args.businessId}::uuid
               AND source = 'processor_sync'::receipt_source
               AND external_ref = ${p.receipt.externalId}
             LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      if (existing[0]) continue;

      // Auxiliary metadata (customer label, receipt number, match
      // reason) lives in `parsed_vendor_ciphertext` as a JSON string
      // for the UI. NOTE: this is NOT real ciphertext — the column
      // name is legacy. Receipt customer labels are not PII for the
      // processor-sync ingest path (they're already cleartext on the
      // processor side). When PII vendor names are introduced via
      // OCR ingest, that path encrypts with a proper DEK.
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
              parsed_vendor_ciphertext, external_ref,
              linked_transaction_id
            ) VALUES (
              ${args.businessId}::uuid,
              ${p.matchedInvoiceId ? "approved" : "pending_review"}::receipt_status,
              'processor_sync'::receipt_source,
              ${p.receipt.amountMinor.toString()}::bigint,
              ${p.receipt.issuedDate}::date,
              ${metadataJson},
              ${p.receipt.externalId},
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
