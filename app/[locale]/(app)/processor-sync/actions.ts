"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  encryptStringWithDek,
  decryptStringWithDek,
} from "@/lib/security/encryption";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import { hypAdapter } from "@/lib/processor-sync/hyp";
import { growAdapter } from "@/lib/processor-sync/grow";
import { payplusAdapter } from "@/lib/processor-sync/payplus";
import type { ProcessorAdapter } from "@/lib/processor-sync/common";

// Processor-sync server actions (Plan v4 Phase F.4 — receipts only).
//
// DEK purpose convention: `business:<businessId>:processor_credentials`.
// One DEK per business → all of that business's processor API keys are
// encrypted under the same DEK. Right-of-erasure deletes the DEK in the
// nightly account-purge cron; the ciphertext columns then become
// mathematically unrecoverable.
//
// AAD for each row: {table:'processor_sync_credentials', column:'api_key_ciphertext', rowId:<credentialId>}.
//
// Step-up gate: revealing or replacing an api_key requires
// `processor.view_credentials`. Connection-test reads the plaintext key
// from the form (operator just typed it), so no step-up is needed for
// the initial connect path — the gate fires when the operator later
// wants to view/edit an EXISTING credential.

const PROCESSOR_ENUM = ["hyp", "grow", "payplus"] as const;

function adapterFor(
  processor: "hyp" | "grow" | "payplus",
): ProcessorAdapter {
  switch (processor) {
    case "hyp":
      return hypAdapter;
    case "grow":
      return growAdapter;
    case "payplus":
      return payplusAdapter;
  }
}

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

const connectSchema = z.object({
  businessId: z.string().uuid(),
  processor: z.enum(PROCESSOR_ENUM),
  apiKey: z.string().trim().min(1).max(1024),
});

export type ConnectResult =
  | { ok: true; credentialId: string }
  | { error: string; connectionMessage?: string }
  | { stepUpRequired: { op: string; payloadHash: string } };

export async function connectProcessor(
  formData: FormData,
): Promise<ConnectResult> {
  const me = await requireCurrentUser();
  const parsed = connectSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { businessId, processor, apiKey } = parsed.data;

  // 1. Smoke-test the credential before persisting. This costs one
  //    light HTTP call against the processor's smallest endpoint.
  const adapter = adapterFor(processor);
  const test = await adapter.testConnection(apiKey);
  if (!test.ok) {
    return {
      error: "app.processorSync.errors.connectionFailed",
      connectionMessage: test.message,
    };
  }

  // 2. Encrypt the key under the business's DEK.
  const purpose = `business:${businessId}:processor_credentials`;
  // We pre-generate a credentialId so the AAD is stable.
  const credentialId = crypto.randomUUID();
  const aad = {
    table: "processor_sync_credentials",
    column: "api_key_ciphertext",
    rowId: credentialId,
  };
  const { ciphertext, dekId } = await encryptStringWithDek({
    purpose,
    plaintext: apiKey,
    aad,
  });
  void dekId; // the DEK is resolved by purpose at decrypt-time

  // 3. Insert. The unique partial index (active = true) means a single
  //    business may only have ONE active credential per processor —
  //    re-connecting requires disconnecting first.
  const result = await withUser(me.appUserId, async (tx) => {
    try {
      const rows = (await tx.execute(
        sql`INSERT INTO processor_sync_credentials (
              id, business_id, processor, api_key_ciphertext,
              synced_doc_kind, active
            ) VALUES (
              ${credentialId}::uuid,
              ${businessId}::uuid,
              ${processor}::processor,
              ${ciphertext},
              'receipt',
              true
            )
            RETURNING id::text AS id`,
      )) as unknown as Array<{ id: string }>;
      return { ok: true as const, id: rows[0]?.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/processor_sync_credentials_unique_active_idx/.test(msg)) {
        return { ok: false as const, error: "app.processorSync.errors.alreadyConnected" };
      }
      return { ok: false as const, error: "app.errors.invalidInput" };
    }
  });

  if (!result.ok || !result.id) {
    return { error: result.error ?? "app.errors.invalidInput" };
  }
  revalidatePath("/processor-sync");
  return { ok: true, credentialId: result.id };
}

const disconnectSchema = z.object({
  credentialId: z.string().uuid(),
});

export async function disconnectProcessor(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = await requireCurrentUser();
  const parsed = disconnectSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  await withUser(me.appUserId, async (tx) => {
    await tx.execute(
      sql`UPDATE processor_sync_credentials
            SET active = false
          WHERE id = ${parsed.data.credentialId}::uuid`,
    );
  });
  revalidatePath("/processor-sync");
  return { ok: true };
}

const revealSchema = z.object({
  credentialId: z.string().uuid(),
});

// Revealing the plaintext API key requires a fresh step-up grant
// scoped to `processor.view_credentials` + the credential id.
export async function revealCredential(
  formData: FormData,
): Promise<
  | { ok: true; apiKey: string }
  | { error: string }
  | { stepUpRequired: { op: string; payloadHash: string } }
> {
  const me = await requireCurrentUser();
  const parsed = revealSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { credentialId } = parsed.data;

  try {
    await requireFreshSession({
      op: "processor.view_credentials",
      payloadHash: computePayloadHash({ credentialId }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return {
        stepUpRequired: { op: err.op, payloadHash: err.payloadHash },
      };
    }
    throw err;
  }

  const apiKey = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text AS id,
                 api_key_ciphertext AS ciphertext
            FROM processor_sync_credentials
           WHERE id = ${credentialId}::uuid
             AND active = true
           LIMIT 1`,
    )) as unknown as Array<{ id: string; ciphertext: string }>;
    const row = rows[0];
    if (!row) return null;
    const aad = {
      table: "processor_sync_credentials",
      column: "api_key_ciphertext",
      rowId: row.id,
    };
    // We need the dekId; recover from purpose via business + DEK helper.
    const businessRows = (await tx.execute(
      sql`SELECT business_id::text AS "businessId"
            FROM processor_sync_credentials
           WHERE id = ${credentialId}::uuid
           LIMIT 1`,
    )) as unknown as Array<{ businessId: string }>;
    const businessId = businessRows[0]?.businessId;
    if (!businessId) return null;
    // We have to look up the DEK by purpose. For simplicity at the
    // action layer we fetch the active DEK for that purpose.
    const { getActiveDek } = await import("@/lib/security/dek");
    const dek = await getActiveDek(
      `business:${businessId}:processor_credentials`,
    );
    if (!dek) return null;
    try {
      return await decryptStringWithDek({
        dekId: dek.dekId,
        ciphertext: row.ciphertext,
        aad,
      });
    } finally {
      dek.plaintext.fill(0);
    }
  });

  if (!apiKey) return { error: "app.errors.invalidInput" };
  return { ok: true, apiKey };
}

const syncNowSchema = z.object({
  credentialId: z.string().uuid(),
});

export type SyncNowResult =
  | { ok: true; fetched: number; paired: number; orphans: number }
  | { error: string };

export async function syncNow(formData: FormData): Promise<SyncNowResult> {
  const me = await requireCurrentUser();
  const parsed = syncNowSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { credentialId } = parsed.data;

  // 1. Load + decrypt the credential.
  const credential = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text AS id,
                 business_id::text AS "businessId",
                 processor::text AS processor,
                 api_key_ciphertext AS ciphertext,
                 sync_cursor AS "syncCursor"
            FROM processor_sync_credentials
           WHERE id = ${credentialId}::uuid
             AND active = true
           LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      businessId: string;
      processor: "hyp" | "grow" | "payplus";
      ciphertext: string;
      syncCursor: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    const { getActiveDek } = await import("@/lib/security/dek");
    const dek = await getActiveDek(
      `business:${row.businessId}:processor_credentials`,
    );
    if (!dek) return null;
    try {
      const apiKey = await decryptStringWithDek({
        dekId: dek.dekId,
        ciphertext: row.ciphertext,
        aad: {
          table: "processor_sync_credentials",
          column: "api_key_ciphertext",
          rowId: row.id,
        },
      });
      return { ...row, apiKey };
    } finally {
      dek.plaintext.fill(0);
    }
  });

  if (!credential) return { error: "app.errors.invalidInput" };

  // 2. Fetch + pair via the shared cron helper. Re-use the helper so
  //    the manual "sync now" and the hourly cron behave identically.
  const { runSyncForCredential } = await import(
    "@/lib/processor-sync/runSync"
  );

  const result = await runSyncForCredential({
    credentialId: credential.id,
    businessId: credential.businessId,
    processor: credential.processor,
    apiKey: credential.apiKey,
    since: credential.syncCursor ?? undefined,
  });

  revalidatePath("/processor-sync");
  revalidatePath("/receipts");
  return result;
}

// Helper used internally by the page to surface "view button required
// step-up" — kept as a server action so the UI can route to the modal.
export async function listCredentials(): Promise<
  Array<{
    id: string;
    processor: string;
    businessId: string;
    businessName: string;
    lastSyncedAt: string | null;
    consecutiveFailures: number;
    active: boolean;
  }>
> {
  const me = await requireCurrentUser();
  return withUser(me.appUserId, async (tx) => {
    return (await tx.execute(
      sql`SELECT c.id::text AS id,
                 c.processor::text AS processor,
                 c.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 c.last_synced_at::text AS "lastSyncedAt",
                 c.consecutive_failures AS "consecutiveFailures",
                 c.active AS active
            FROM processor_sync_credentials c
            JOIN businesses b ON b.id = c.business_id
           WHERE c.active = true
           ORDER BY c.processor ASC, b.legal_name ASC`,
    )) as unknown as Array<{
      id: string;
      processor: string;
      businessId: string;
      businessName: string;
      lastSyncedAt: string | null;
      consecutiveFailures: number;
      active: boolean;
    }>;
  });
}
