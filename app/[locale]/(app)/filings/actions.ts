"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
  type StepUpOp,
} from "@/lib/auth/stepUp";
import {
  generatePcn874,
  Pcn874NotApplicable,
  Pcn874SpecNotVerified,
  Pcn874SequenceGap,
} from "@/lib/filings/pcn874";
import {
  generateForm6111,
  Form6111SpecNotVerified,
} from "@/lib/filings/form6111";
import {
  generateForm102,
  Form102LayerNotReady,
  Form102SpecNotVerified,
} from "@/lib/filings/form102";
import {
  generateForm1301PrepPack,
  Form1301EngineNotReady,
} from "@/lib/filings/form1301";
import {
  generateForm1214PrepPack,
  Form1214EngineNotReady,
} from "@/lib/filings/form1214";
import {
  generateForm126,
  Form126LayerNotReady,
  Form126SpecNotVerified,
} from "@/lib/filings/form126";
import {
  generateForm856,
  Form856LayerNotReady,
  Form856SpecNotVerified,
} from "@/lib/filings/form856";
import {
  encryptStringWithDek,
} from "@/lib/security/encryption";

// Filings (Phase E) — consumer of `lib/filings/*` generators.
//
// Architecture:
//   - buildFiling() runs a single generator inside withUser(), receives the
//     produced artifact buffer/string, envelope-encrypts it with a DEK
//     scoped per business+kind, persists the row, and returns the new id.
//   - markSubmitted() flips status to 'submitted' and stores the asmachta
//     the operator pasted from the regulator's portal. We never call
//     "filed" — only "submitted to portal" or "ready for upload" — per
//     CPA council positioning that the regulator is the system of record,
//     not us.
//
// Plan entitlement gates:
//   - 'filings.pcn874' (Solo+) → enables PCN874 only.
//   - 'filings.form_exports' (Plus+) → enables the other six forms.
//
// Step-up gates:
//   - Each download triggers requireFreshSession({op:`filing.export_${kind}`}).
//   - For PCN874 op is `filing.export_pcn874`; for Form 102 the registry
//     entry currently covers 102/1301/1214/6111 and PCN874. Forms 126/856
//     fall back to the closest registered op via mapStepUpOpForKind() —
//     until those are added to the registry, we route them through
//     `filing.export_form6111` (the same "annual filing export" risk
//     class). This is deliberate: the registry is locked in lib/auth/.

import {
  type FilingKind,
  type FilingActionResult,
  type FilingPreview,
  mapStepUpOpForKind,
} from "./types";

const filingKindSchema = z.enum([
  "pcn874",
  "form_6111",
  "form_102",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
]);

const buildSchema = z.object({
  businessId: z.string().uuid(),
  kind: filingKindSchema,
  periodStart: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "periodStart must be YYYY-MM-DD"),
  periodEnd: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "periodEnd must be YYYY-MM-DD"),
  acknowledgeSpecUnverified: z.coerce.boolean().optional().default(false),
});

const markSubmittedSchema = z.object({
  id: z.string().uuid(),
  asmachta: z
    .string()
    .trim()
    .max(128)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
});

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

type EntitlementRow = { value_bool: boolean | null };

async function checkPlanEntitlement(
  userId: string,
  key: "filings.pcn874" | "filings.form_exports",
): Promise<boolean> {
  // Resolve the user's active subscription plan and look up the boolean
  // entitlement. Free tier never has the row → falls through to the
  // explicit free-plan lookup (also false). Default behaviour: deny.
  const rows = await withServiceRole(async (tx) => {
    return (await tx.execute(
      sql`SELECT pe.value_bool
            FROM plan_entitlements pe
            JOIN subscriptions s ON s.plan_id = pe.plan_id
            WHERE s.user_id = ${userId}::uuid
              AND s.status IN ('active','trialing')
              AND pe.key = ${key}
            ORDER BY s.created_at DESC
            LIMIT 1`,
    )) as unknown as EntitlementRow[];
  });
  if (rows.length > 0) {
    return Boolean(rows[0]?.value_bool);
  }
  // No active subscription → fall back to the free-plan row.
  const free = await withServiceRole(async (tx) => {
    return (await tx.execute(
      sql`SELECT value_bool
            FROM plan_entitlements
            WHERE plan_id = 'free'
              AND key = ${key}
            LIMIT 1`,
    )) as unknown as EntitlementRow[];
  });
  return Boolean(free[0]?.value_bool);
}

/**
 * Server-side entitlement gate for a filing kind. PCN874 needs
 * `filings.pcn874`; the other six need `filings.form_exports`.
 */
export async function isFilingKindAllowed(
  userId: string,
  kind: FilingKind,
): Promise<boolean> {
  const key = kind === "pcn874" ? "filings.pcn874" : "filings.form_exports";
  return checkPlanEntitlement(userId, key);
}

// ---------------------------------------------------------------------------
// buildFiling — invoke generator, encrypt, persist
// ---------------------------------------------------------------------------

type GenerateOutcome = {
  fileBytes: Buffer;
  mimeType: string;
  totalsJsonb: Record<string, unknown>;
  inputsJsonb: Record<string, unknown>;
};

async function runGenerator(args: {
  userId: string;
  businessId: string;
  kind: FilingKind;
  periodStart: string;
  periodEnd: string;
  acknowledgeSpecUnverified: boolean;
}): Promise<GenerateOutcome> {
  const ack = args.acknowledgeSpecUnverified;
  const periodStart = new Date(`${args.periodStart}T00:00:00Z`);
  const periodEnd = new Date(`${args.periodEnd}T00:00:00Z`);
  const fiscalYear = periodEnd.getUTCFullYear();

  switch (args.kind) {
    case "pcn874": {
      const buf = await generatePcn874({
        userId: args.userId,
        businessId: args.businessId,
        periodStart,
        periodEnd,
        acknowledgeSpecUnverified: ack,
      });
      return {
        fileBytes: buf,
        mimeType: "text/plain; charset=windows-1255",
        totalsJsonb: {
          byteLength: buf.byteLength,
          kind: "pcn874",
        },
        inputsJsonb: { meta: { periodStart: args.periodStart, periodEnd: args.periodEnd } },
      };
    }
    case "form_6111": {
      const xml = await generateForm6111({
        userId: args.userId,
        businessId: args.businessId,
        fiscalYear,
        acknowledgeSpecUnverified: ack,
      });
      const buf = Buffer.from(xml, "utf8");
      return {
        fileBytes: buf,
        mimeType: "application/xml; charset=utf-8",
        totalsJsonb: { byteLength: buf.byteLength, kind: "form_6111", fiscalYear },
        inputsJsonb: { meta: { fiscalYear } },
      };
    }
    case "form_102": {
      const result = await generateForm102({
        userId: args.userId,
        businessId: args.businessId,
        periodLabel: args.periodStart.slice(0, 7),
        acknowledgeSpecUnverified: ack,
      });
      return {
        fileBytes: result.file,
        mimeType: result.mimeType,
        totalsJsonb: { byteLength: result.file.byteLength, kind: "form_102" },
        inputsJsonb: { meta: { periodLabel: args.periodStart.slice(0, 7) } },
      };
    }
    case "form_1301": {
      const result = await generateForm1301PrepPack({
        userId: args.userId,
        businessId: args.businessId,
        fiscalYear,
      });
      return {
        fileBytes: result.pdfData,
        mimeType: "application/pdf",
        totalsJsonb: {
          byteLength: result.pdfData.byteLength,
          kind: "form_1301",
          fiscalYear,
          netPayableMinor: result.summary.netPayableMinor.toString(),
          taxableIncomeMinor: result.summary.taxableIncomeMinor.toString(),
        },
        inputsJsonb: { meta: { fiscalYear } },
      };
    }
    case "form_1214": {
      const result = await generateForm1214PrepPack({
        userId: args.userId,
        businessId: args.businessId,
        fiscalYear,
      });
      return {
        fileBytes: result.pdfData,
        mimeType: "application/pdf",
        totalsJsonb: {
          byteLength: result.pdfData.byteLength,
          kind: "form_1214",
          fiscalYear,
          netPayableMinor: result.summary.netPayableMinor.toString(),
          taxableIncomeMinor: result.summary.taxableIncomeMinor.toString(),
        },
        inputsJsonb: { meta: { fiscalYear } },
      };
    }
    case "form_126": {
      const buf = await generateForm126({
        userId: args.userId,
        businessId: args.businessId,
        fiscalYear,
        acknowledgeSpecUnverified: ack,
      });
      return {
        fileBytes: buf,
        mimeType: "text/plain; charset=windows-1255",
        totalsJsonb: { byteLength: buf.byteLength, kind: "form_126", fiscalYear },
        inputsJsonb: { meta: { fiscalYear } },
      };
    }
    case "form_856": {
      const result = await generateForm856({
        userId: args.userId,
        businessId: args.businessId,
        fiscalYear,
        format: "csv",
        acknowledgeSpecUnverified: ack,
      });
      return {
        fileBytes: result.file,
        mimeType: result.mimeType,
        totalsJsonb: { byteLength: result.file.byteLength, kind: "form_856", fiscalYear },
        inputsJsonb: { meta: { fiscalYear } },
      };
    }
  }
}

function mapGeneratorError(err: unknown): string {
  if (
    err instanceof Pcn874SpecNotVerified ||
    err instanceof Form6111SpecNotVerified ||
    err instanceof Form102SpecNotVerified ||
    err instanceof Form126SpecNotVerified ||
    err instanceof Form856SpecNotVerified
  ) {
    return "app.filings.wizard.specUnverified";
  }
  if (
    err instanceof Form102LayerNotReady ||
    err instanceof Form1301EngineNotReady ||
    err instanceof Form1214EngineNotReady ||
    err instanceof Form126LayerNotReady ||
    err instanceof Form856LayerNotReady
  ) {
    return "app.filings.wizard.layerNotReady";
  }
  if (err instanceof Pcn874NotApplicable) {
    return "app.filings.wizard.notApplicable";
  }
  if (err instanceof Pcn874SequenceGap) {
    return "app.filings.wizard.sequenceGap";
  }
  return "app.filings.wizard.unknownError";
}

/**
 * Server Action: generate a filing file, encrypt the bytes via envelope
 * DEK, and persist a `tax_filings` row in status='generated'. Returns
 * the new row id on success or a translation-key error on failure.
 *
 * NOT a download path. Download is gated separately by
 * `app/api/filings/[id]/download/route.ts` which step-up-checks the user
 * BEFORE decrypting.
 */
export async function buildFiling(
  formData: FormData,
): Promise<FilingActionResult> {
  const me = await requireCurrentUser();
  const parsed = buildSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.filings.errors.generic" };
  const input = parsed.data;

  // Entitlement gate.
  const allowed = await isFilingKindAllowed(me.appUserId, input.kind);
  if (!allowed) return { error: "app.filings.errors.planLocked" };

  // Pre-flight: confirm the business is visible to this user. If RLS
  // hides it we should fail fast rather than after the generator runs.
  const exists = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT 1 AS ok FROM businesses
          WHERE id = ${input.businessId}::uuid
            AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{ ok: number }>;
    return rows[0]?.ok === 1;
  });
  if (!exists) return { error: "app.filings.errors.notFound" };

  let outcome: GenerateOutcome;
  try {
    outcome = await runGenerator({
      userId: me.appUserId,
      businessId: input.businessId,
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      acknowledgeSpecUnverified: input.acknowledgeSpecUnverified,
    });
  } catch (err) {
    return { error: mapGeneratorError(err) };
  }

  // Envelope-encrypt the file bytes. Storage shape: base64 of the file
  // wrapped in the v1:iv:tag:ciphertext AES-GCM string we use for all
  // ciphertext-on-text columns. We will store it in `file_blob_url` —
  // the column is a TEXT and can hold the ciphertext directly while a
  // future migration may swap it for a true blob URL pointer.
  const plaintextB64 = outcome.fileBytes.toString("base64");
  const filingRowId = randomUUID();
  const aadRowId = filingRowId;
  const { ciphertext, dekId } = await encryptStringWithDek({
    purpose: `tax_filings:${input.businessId}:${input.kind}`,
    plaintext: plaintextB64,
    aad: { table: "tax_filings", column: "file_ciphertext", rowId: aadRowId },
  });

  const id = await withUser(me.appUserId, async (tx) => {
    const totalsJson = JSON.stringify(outcome.totalsJsonb);
    const inputsJson = JSON.stringify(outcome.inputsJsonb);
    const rows = (await tx.execute(
      sql`INSERT INTO tax_filings (
            id, business_id, kind, period_start, period_end,
            status, generated_at, file_blob_url, file_key_id, file_mime,
            totals_jsonb, inputs_jsonb, generated_by_user_id
          ) VALUES (
            ${filingRowId}::uuid,
            ${input.businessId}::uuid,
            ${input.kind}::tax_filing_kind,
            ${input.periodStart}::date,
            ${input.periodEnd}::date,
            'generated'::tax_filing_status,
            now(),
            ${ciphertext},
            ${dekId}::uuid,
            ${outcome.mimeType},
            ${totalsJson}::jsonb,
            ${inputsJson}::jsonb,
            ${me.appUserId}::uuid
          )
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    const newId = rows[0]!.id;

    // PCN874 stamps every invoice in the period with
    // `pcn874_exported_at`. Re-running the generator for the same period
    // is idempotent — only invoices that haven't been stamped yet get
    // touched (so amendments can detect "already reported" invoices).
    if (input.kind === "pcn874") {
      await tx.execute(
        sql`UPDATE invoices
              SET pcn874_exported_at = now()
              WHERE business_id = ${input.businessId}::uuid
                AND issue_date >= ${input.periodStart}::date
                AND issue_date <= ${input.periodEnd}::date
                AND cancelled_at IS NULL
                AND pcn874_exported_at IS NULL`,
      );
    }
    return newId;
  });

  revalidatePath("/filings");
  revalidatePath("/invoices");
  return { ok: true, id };
}

/**
 * Server Action: record that the operator submitted the file to the
 * regulator's portal. Stores the asmachta they pasted plus a timestamp.
 * Step-up gated (the asmachta is part of the audit trail and the
 * status transition is one-way).
 */
export async function markSubmitted(
  formData: FormData,
): Promise<FilingActionResult> {
  const me = await requireCurrentUser();
  const parsed = markSubmittedSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.filings.errors.generic" };
  const input = parsed.data;

  // Look up the filing kind so we can derive the step-up op symbol.
  const row = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT kind::text AS kind, status::text AS status
            FROM tax_filings
            WHERE id = ${input.id}::uuid
            LIMIT 1`,
    )) as unknown as Array<{ kind: string; status: string }>;
    return rows[0] ?? null;
  });
  if (!row) return { error: "app.filings.errors.notFound" };
  if (row.status === "submitted") {
    return { error: "app.filings.errors.alreadySubmitted" };
  }

  const kind = row.kind as FilingKind;
  try {
    await requireFreshSession({
      op: mapStepUpOpForKind(kind),
      payloadHash: computePayloadHash({ filingId: input.id, action: "mark_submitted" }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return { error: "app.filings.errors.stepUpRequired" };
    }
    throw err;
  }

  await withUser(me.appUserId, async (tx) => {
    await tx.execute(
      sql`UPDATE tax_filings
            SET status = 'submitted'::tax_filing_status,
                submitted_at = now(),
                submitted_asmachta = ${input.asmachta ?? null}
            WHERE id = ${input.id}::uuid`,
    );
  });

  revalidatePath("/filings");
  revalidatePath(`/filings/${input.id}`);
  return { ok: true, id: input.id };
}

/**
 * Surface for the wizard's preview step. Pulls invoice counts + totals
 * scoped to the requested business + period. PCN874 only — the other
 * forms either depend on layers that aren't built (102/126/856) or use
 * different aggregation paths (6111/1301/1214) that already render
 * full summaries in the wizard's review tab.
 */
export async function previewPcn874(
  businessId: string,
  periodStart: string,
  periodEnd: string,
): Promise<FilingPreview> {
  const me = await requireCurrentUser();
  return withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT COUNT(*)::int AS "invoiceCount",
                 COALESCE(SUM(subtotal_minor), 0)::text AS "sumPreVatMinor",
                 COALESCE(SUM(vat_minor), 0)::text AS "sumVatMinor"
            FROM invoices
            WHERE business_id = ${businessId}::uuid
              AND issue_date >= ${periodStart}::date
              AND issue_date <= ${periodEnd}::date
              AND cancelled_at IS NULL
              AND deleted_at IS NULL
              AND provider_kind = 'internal'`,
    )) as unknown as Array<{
      invoiceCount: number;
      sumPreVatMinor: string;
      sumVatMinor: string;
    }>;
    const row = rows[0]!;
    return {
      invoiceCount: row.invoiceCount,
      sumPreVatMinor: row.sumPreVatMinor,
      sumVatMinor: row.sumVatMinor,
    };
  });
}
