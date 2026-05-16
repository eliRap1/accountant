"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  parseBankFile,
  type BankSourceFormat,
} from "@/lib/bank-imports/index";
import { fingerprintTransaction } from "@/lib/recon/dedup";

// Bank-import server actions (Plan v4 Phase F.2).
//
// Flow:
//   1. uploadAndParse: operator drops a file → we parse → save the
//      parsed rows into `bank_statement_imports.parsed_transactions_jsonb`
//      with status='pending'. The row is the durable handle for the
//      review page.
//   2. commitImport: operator confirms the rows → we INSERT into
//      `transactions` with `source='bank_import'` and a fingerprint-
//      derived `source_external_id` for idempotency. The
//      bank_statement_imports row flips to status='committed'.
//
// We never auto-commit. The review page surfaces dedup warnings
// computed live via fingerprintTransaction so the operator can
// uncheck duplicates before they hit the transactions table.

const SOURCE_FORMATS = [
  "leumi_pdf",
  "hapoalim_csv",
  "mizrahi_xlsx",
  "discount_csv",
  "ofx",
  "csv",
  "greeninvoice_csv",
] as const;

const uploadSchema = z.object({
  businessId: z.string().uuid(),
  bank: z.string().trim().min(1).max(64),
  sourceFormat: z.enum(SOURCE_FORMATS),
  fileName: z.string().trim().max(255),
  fileBase64: z.string().min(1),
  csvMappingJson: z.string().optional().or(z.literal("")),
});

export type UploadResult =
  | { ok: true; importId: string; rowCount: number; warnings: string[] }
  | { error: string };

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

export async function uploadAndParse(
  formData: FormData,
): Promise<UploadResult> {
  const me = await requireCurrentUser();
  const parsed = uploadSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.fileBase64, "base64");
  } catch {
    return { error: "app.errors.invalidInput" };
  }
  if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
    return { error: "app.bankImports.errors.fileTooLarge" };
  }

  let csvMapping: Parameters<typeof parseBankFile>[0]["csvMapping"];
  if (input.csvMappingJson && input.csvMappingJson.trim() !== "") {
    try {
      csvMapping = JSON.parse(input.csvMappingJson);
    } catch {
      return { error: "app.errors.invalidInput" };
    }
  }

  let parsedResult: Awaited<ReturnType<typeof parseBankFile>>;
  try {
    parsedResult = await parseBankFile({
      bank: input.bank,
      sourceFormat: input.sourceFormat as BankSourceFormat,
      buffer,
      fileName: input.fileName,
      csvMapping,
    });
  } catch (err) {
    // Parser messages can include raw row text + bank-specific strings.
    // Log the cause server-side, return a stable translation key.
    console.error("[bank-imports] parse failed", err);
    return { error: "app.bankImports.errors.parseFailed" };
  }

  // Stubbed parsers (Leumi PDF, Mizrahi XLSX, …) return zero rows and
  // a "stubbed" warning string instead of throwing. Without this guard
  // we silently INSERT a row_count=0 import + the operator believes
  // their statement uploaded successfully.
  if (
    parsedResult.rows.length === 0 &&
    parsedResult.warnings?.some((w) => /stub/i.test(w))
  ) {
    console.warn("[bank-imports] parser stubbed for", input.bank, input.sourceFormat);
    return { error: "app.bankImports.errors.parserNotImplemented" };
  }

  // Convert bigints to strings before JSON serialisation; the JSONB
  // column doesn't preserve bigint precision otherwise.
  const serialisedRows = parsedResult.rows.map((r) => ({
    txnDate: r.txnDate,
    amountMinor: r.amountMinor.toString(),
    currency: r.currency,
    description: r.description,
    counterparty: r.counterparty,
  }));

  const importId = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO bank_statement_imports (
            business_id, bank, source_format, file_name,
            parsed_transactions_jsonb, row_count, status,
            imported_by_user_id, error_jsonb
          ) VALUES (
            ${input.businessId}::uuid,
            ${input.bank},
            ${input.sourceFormat}::bank_format,
            ${input.fileName},
            ${JSON.stringify(serialisedRows)}::jsonb,
            ${parsedResult.rows.length},
            'pending'::bank_import_status,
            ${me.appUserId}::uuid,
            ${JSON.stringify({ warnings: parsedResult.warnings })}::jsonb
          )
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = rows[0]?.id;
    if (!newId) throw new Error("uploadAndParse: no row returned");
    return newId;
  });

  revalidatePath("/bank-imports");
  return {
    ok: true,
    importId,
    rowCount: parsedResult.rows.length,
    warnings: parsedResult.warnings,
  };
}

const commitSchema = z.object({
  importId: z.string().uuid(),
  financialAccountId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
  // JSON array of selected row indices (relative to parsed_transactions_jsonb).
  selectedIndicesJson: z.string().min(2),
});

export type CommitResult =
  | { ok: true; inserted: number; skipped: number }
  | { error: string };

export async function commitImport(
  formData: FormData,
): Promise<CommitResult> {
  const me = await requireCurrentUser();
  const parsed = commitSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { importId, financialAccountId, selectedIndicesJson } = parsed.data;

  let selected: number[];
  try {
    const arr = JSON.parse(selectedIndicesJson);
    selected = z.array(z.number().int().min(0)).parse(arr);
  } catch {
    return { error: "app.errors.invalidInput" };
  }
  const selectedSet = new Set(selected);

  const result = await withUser(me.appUserId, async (tx) => {
    const importRows = (await tx.execute(
      sql`SELECT id::text AS id,
                 business_id::text AS "businessId",
                 parsed_transactions_jsonb AS rows,
                 status::text AS status
            FROM bank_statement_imports
           WHERE id = ${importId}::uuid
           LIMIT 1`,
    )) as unknown as Array<{
      id: string;
      businessId: string;
      rows: Array<{
        txnDate: string;
        amountMinor: string;
        currency: string;
        description: string;
        counterparty: string;
      }>;
      status: string;
    }>;
    const imp = importRows[0];
    if (!imp) return { error: "app.errors.invalidInput" as const };
    if (imp.status !== "pending") {
      return { error: "app.bankImports.errors.alreadyCommitted" as const };
    }

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < imp.rows.length; i++) {
      if (!selectedSet.has(i)) continue;
      const r = imp.rows[i]!;
      const amountMinor = BigInt(r.amountMinor);
      const fingerprint = fingerprintTransaction({
        amountMinor,
        txnDate: new Date(`${r.txnDate}T00:00:00Z`),
        counterparty: r.counterparty,
      });
      // The unique index transactions_source_external_idx makes this
      // upsert idempotent — repeated commits skip seen rows.
      const direction =
        amountMinor > 0n
          ? "income"
          : amountMinor < 0n
            ? "expense"
            : "transfer";
      const absAmount = amountMinor < 0n ? -amountMinor : amountMinor;
      const insertResult = (await tx.execute(
        sql`INSERT INTO transactions (
              business_id, financial_account_id, direction,
              amount_minor, currency, description, txn_date,
              source, source_external_id, metadata_jsonb
            ) VALUES (
              ${imp.businessId}::uuid,
              ${financialAccountId}::uuid,
              ${direction}::transaction_direction,
              ${absAmount.toString()}::bigint,
              ${r.currency},
              ${r.description},
              ${r.txnDate}::date,
              'bank_import'::transaction_source,
              ${`bank_import:${fingerprint}`},
              ${JSON.stringify({ fingerprint, importId: imp.id })}::jsonb
            )
            ON CONFLICT (source, source_external_id) WHERE source_external_id IS NOT NULL
            DO NOTHING
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      if (insertResult.length > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }

    // Flip the import row to committed.
    await tx.execute(
      sql`UPDATE bank_statement_imports
            SET status = 'committed'::bank_import_status,
                committed_at = now()
          WHERE id = ${importId}::uuid`,
    );

    return { ok: true as const, inserted, skipped };
  });

  if ("error" in result) return result;
  revalidatePath("/bank-imports");
  revalidatePath(`/bank-imports/${importId}`);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true, inserted: result.inserted, skipped: result.skipped };
}
