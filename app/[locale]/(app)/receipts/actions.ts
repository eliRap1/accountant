"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { businesses } from "@/db/schema/businesses";
import { receipts, transactions } from "@/db/schema/money-flows";
import { encryptStringWithDek } from "@/lib/security/encryption";
import { dekPurposeForReceiptImage } from "@/lib/receipts/storage";

export type ReceiptActionResult =
  | { ok: true; id: string }
  | { error: string };

function parseFormData(formData: FormData): Record<string, FormDataEntryValue> {
  const obj: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

// ---------------------------------------------------------------------------
// updateReceiptParsedFields — operator-driven correction of OCR output.
// The receipt row stays at `pending_review` until they hit Approve.

const updateParsedSchema = z.object({
  id: z.string().uuid(),
  parsedAmountMajor: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
  parsedVatMajor: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
  parsedDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
  parsedVendor: z.string().trim().max(500).optional().or(z.literal("")),
  categoryCode: z.string().trim().max(20).optional().or(z.literal("")),
  businessUsePct: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .default("100.00"),
});

function majorToMinor(major: string): bigint {
  const n = Number.parseFloat(major);
  if (!Number.isFinite(n)) throw new Error("majorToMinor: invalid number");
  return BigInt(Math.round(n * 100));
}

export async function updateReceiptParsedFields(
  formData: FormData,
): Promise<ReceiptActionResult> {
  const me = await requireCurrentUser();
  const parsed = updateParsedSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;

  await withUser(me.appUserId, async (tx) => {
    const row = (await tx.execute(
      sql`SELECT business_id::text AS "businessId"
            FROM receipts WHERE id = ${input.id}::uuid LIMIT 1`,
    )) as unknown as Array<{ businessId: string }>;
    const businessId = row[0]?.businessId;
    if (!businessId) throw new Error("receipt not found");

    // Vendor is encrypted under the per-business DEK. Empty string =
    // operator cleared the field — we leave the ciphertext NULL.
    let vendorCiphertext: string | null = null;
    if (input.parsedVendor && input.parsedVendor !== "") {
      const enc = await encryptStringWithDek({
        purpose: `business:${businessId}:receipt_vendor`,
        plaintext: input.parsedVendor,
        aad: {
          table: "receipts",
          column: "parsed_vendor_ciphertext",
          rowId: input.id,
        },
      });
      vendorCiphertext = enc.ciphertext;
    }

    const amountMinor =
      input.parsedAmountMajor !== null
        ? majorToMinor(input.parsedAmountMajor)
        : null;
    const vatMinor =
      input.parsedVatMajor !== null
        ? majorToMinor(input.parsedVatMajor)
        : null;

    await tx
      .update(receipts)
      .set({
        parsedAmountMinor: amountMinor,
        parsedVatMinor: vatMinor,
        parsedDate: input.parsedDate,
        parsedVendorCiphertext: vendorCiphertext,
        categoryCode:
          input.categoryCode === undefined || input.categoryCode === ""
            ? null
            : input.categoryCode,
        businessUsePct: input.businessUsePct,
      })
      .where(eq(receipts.id, input.id));
  });

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${input.id}`);
  return { ok: true, id: input.id };
}

// ---------------------------------------------------------------------------
// approveReceipt — flip status to approved; create a linked transaction
// if none exists yet. The transaction draft uses the operator-corrected
// parsed_* fields (not the raw OCR), since the operator is the source
// of truth at this point.

const approveSchema = z.object({ id: z.string().uuid() });

export async function approveReceipt(
  formData: FormData,
): Promise<ReceiptActionResult> {
  const me = await requireCurrentUser();
  const parsed = approveSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id } = parsed.data;

  await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text, business_id::text AS "businessId",
                 parsed_amount_minor::text AS "parsedAmountMinor",
                 parsed_vat_minor::text AS "parsedVatMinor",
                 parsed_date::text AS "parsedDate",
                 category_code AS "categoryCode",
                 business_use_pct::text AS "businessUsePct",
                 linked_transaction_id::text AS "linkedTransactionId"
            FROM receipts WHERE id = ${id}::uuid LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      businessId: string;
      parsedAmountMinor: string | null;
      parsedVatMinor: string | null;
      parsedDate: string | null;
      categoryCode: string | null;
      businessUsePct: string;
      linkedTransactionId: string | null;
    }>;
    const r = rows[0];
    if (!r) throw new Error("receipt not found");

    // Need at minimum an amount + date to create a transaction. Without
    // them we still flip status (operator marked it approved as a
    // standalone record); the transaction link stays NULL.
    if (
      !r.linkedTransactionId &&
      r.parsedAmountMinor &&
      r.parsedDate
    ) {
      // Recoverable VAT = parsed_vat_minor * business_use_pct/100.
      // Stored on the receipts row for the VAT estimator (snapshot.ts).
      let vatRecoverableMinor: bigint | null = null;
      if (r.parsedVatMinor !== null) {
        const vat = BigInt(r.parsedVatMinor);
        const pct = Math.round(Number(r.businessUsePct) * 100);
        vatRecoverableMinor = (vat * BigInt(pct)) / 10_000n;
      }

      const txn = (await tx.execute(
        sql`INSERT INTO transactions (
              business_id, direction, category_code,
              amount_minor, currency, description,
              txn_date, source, linked_receipt_id
            )
            VALUES (
              ${r.businessId}::uuid,
              'expense'::transaction_direction,
              ${r.categoryCode},
              ${r.parsedAmountMinor}::bigint,
              'ILS',
              NULL,
              ${r.parsedDate}::date,
              'ocr'::transaction_source,
              ${id}::uuid
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const txnId = txn[0]?.id ?? null;

      await tx
        .update(receipts)
        .set({
          status: "approved",
          linkedTransactionId: txnId,
          vatRecoverableMinor,
        })
        .where(eq(receipts.id, id));
    } else {
      await tx.update(receipts).set({ status: "approved" }).where(eq(receipts.id, id));
    }
  });

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${id}`);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// rejectReceipt — flip status to rejected. Keeps the row for audit
// (Plan v4: no hard deletes for financial records).

export async function rejectReceipt(
  formData: FormData,
): Promise<ReceiptActionResult> {
  const me = await requireCurrentUser();
  const parsed = approveSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id } = parsed.data;

  await withUser(me.appUserId, async (tx) => {
    await tx
      .update(receipts)
      .set({ status: "rejected" })
      .where(eq(receipts.id, id));
  });

  revalidatePath("/receipts");
  revalidatePath(`/receipts/${id}`);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// preallocateReceiptId — used by the upload flow so AAD can be computed
// before the bytes hit the wire. The API route calls this, then uploads
// the blob, then the row insert references the same id.

export async function preallocateReceiptId(): Promise<{ id: string }> {
  // Pure CSPRNG — no DB hop. The dummy await keeps this safe to call
  // from a Server Action context (which expects async).
  await Promise.resolve();
  return { id: crypto.randomUUID() };
}

// Suppress an unused-import warning under noUnusedLocals when the
// transactions / businesses imports are only referenced inside SQL.
void transactions;
void businesses;
