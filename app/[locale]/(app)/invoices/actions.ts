"use server";

import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { businesses } from "@/db/schema/businesses";
import { invoices, invoiceLineItems } from "@/db/schema/invoicing";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import {
  requiresAllocationNumber,
  activeThresholdAt,
} from "@/lib/invoices/allocationThreshold";
import { selectProvider } from "@/lib/invoices/providers/IInvoiceProvider";
import type {
  InvoiceLineInput,
  InvoiceIssueInput,
} from "@/lib/invoices/providers/IInvoiceProvider";

// IL invoice CRUD via the manual (internal) provider. We never hard-delete
// invoices — Plan v4 § Locked Decisions. Edit is allowed only on draft-
// equivalent rows, which here means rows the operator has staged but not
// committed yet. There is no `draft` status in the schema; the schema
// records a row as "live" once issued (cancelled_at IS NULL). To support
// edit + cancel-as-credit-note we expose three actions:
//
//   - createInvoice: stages line items, computes totals, calls provider
//     issueInvoice() inside a withUser tx — provider handles sequence +
//     allocation status + row insert + audit.
//   - updateDraftInvoice: edits are blocked unless the row is unissued
//     (we treat sequentialNumber=0 as draft sentinel — but our provider
//     always allocates a sequence on issue, so in practice this action
//     is currently a no-op stub that returns "immutable" for any row
//     created via createInvoice. Kept for API contract symmetry with
//     other CRUD surfaces; once Phase D adds an explicit `draft` state
//     this lights up).
//   - cancelInvoice: provider emits a linked credit_note + flips parent
//     cancelled_at — atomic in one tx.

const invoiceTypeEnum = z.enum([
  "tax_invoice",
  "tax_invoice_receipt",
  "receipt",
  "credit_note",
  "proforma",
  "debit_note",
  "self_invoice",
]);

const lineSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  // Major-unit string (operator enters "3.5", we store as numeric(18,4)).
  quantity: z.string().trim().regex(/^\d+(\.\d{1,4})?$/),
  // Major-unit ILS (we convert to minor before storage).
  unitPriceMajor: z.coerce.number().min(0).max(1_000_000_000),
  // 0..100 as decimal string (e.g. "18.00", "0.00"). We pass it to the
  // numeric(4,2) col verbatim after a parse check.
  vatRate: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/),
});

const baseInvoiceSchema = z.object({
  id: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  clientId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  invoiceType: invoiceTypeEnum,
  issueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  currency: z.string().trim().length(3).default("ILS"),
  fxRate: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  notesHe: z.string().trim().max(4000).optional().or(z.literal("")),
  notesEn: z.string().trim().max(4000).optional().or(z.literal("")),
  allocationNumber: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  // JSON-serialised line items; the form encodes the array as a single
  // hidden field so we can use a plain FormData submission.
  linesJson: z.string().min(2),
});

export type InvoiceActionResult =
  | { ok: true; id: string }
  | { error: string };

function parseFormData(formData: FormData): unknown {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Bankers' rounding (half-even) on a bigint via numerator/denominator
// integer math — used to derive line VAT given a rate. Matches the
// canonical IL ITA rounding for invoice totals (see lib/tax/il/vat.ts for
// header-level VAT; per-line uses the same shape but scoped to one line).
function roundHalfEvenDiv(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("roundHalfEvenDiv: division by zero");
  const negative = (num < 0n) !== (den < 0n);
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const q = absNum / absDen;
  const r = absNum % absDen;
  const twiceR = r * 2n;
  let rounded: bigint;
  if (twiceR < absDen) {
    rounded = q;
  } else if (twiceR > absDen) {
    rounded = q + 1n;
  } else {
    // Exactly half — pick even quotient.
    rounded = q % 2n === 0n ? q : q + 1n;
  }
  return negative ? -rounded : rounded;
}

function computeLineTotals(args: {
  quantity: string;
  unitPriceMajor: number;
  vatRate: string;
}): { lineSubtotalMinor: bigint; lineVatMinor: bigint } {
  // quantity is numeric(18,4) — preserve via string parsing into integer
  // micro-units (×10_000). unitPriceMajor already arrived as a number,
  // safe up to ~9e15 for our domain, but we still snap to integer minor.
  const qMicro = BigInt(
    Math.round(Number.parseFloat(args.quantity) * 10_000),
  );
  const unitMinor = BigInt(Math.round(args.unitPriceMajor * 100));
  // line subtotal in minor = (qMicro * unitMinor) / 10_000 (scale back).
  const lineSubtotalMinor = roundHalfEvenDiv(qMicro * unitMinor, 10_000n);
  // VAT rate is decimal % string. Use micros (×10_000) to keep precision.
  const rateMicro = BigInt(
    Math.round(Number.parseFloat(args.vatRate) * 10_000),
  );
  // VAT minor = subtotalMinor * (rateMicro / 10_000) / 100
  // = subtotalMinor * rateMicro / 1_000_000.
  const lineVatMinor = roundHalfEvenDiv(
    lineSubtotalMinor * rateMicro,
    1_000_000n,
  );
  return { lineSubtotalMinor, lineVatMinor };
}

function aggregateInvoiceTotals(
  lines: ReadonlyArray<z.infer<typeof lineSchema>>,
): {
  lineRows: InvoiceLineInput[];
  subtotalMinor: bigint;
  vatMinor: bigint;
  totalMinor: bigint;
  headerVatRate: string;
} {
  let subtotalMinor = 0n;
  let vatMinor = 0n;
  const lineRows: InvoiceLineInput[] = [];
  // Use first non-zero line rate as header; falls back to "0.00".
  let headerVatRate = "0.00";
  let headerSet = false;
  lines.forEach((line, idx) => {
    const { lineSubtotalMinor, lineVatMinor } = computeLineTotals({
      quantity: line.quantity,
      unitPriceMajor: line.unitPriceMajor,
      vatRate: line.vatRate,
    });
    subtotalMinor += lineSubtotalMinor;
    vatMinor += lineVatMinor;
    const unitPriceMinor = BigInt(Math.round(line.unitPriceMajor * 100));
    lineRows.push({
      position: idx + 1,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor,
      vatRate: line.vatRate,
      lineTotalMinor: lineSubtotalMinor,
    });
    if (!headerSet) {
      headerVatRate = line.vatRate;
      headerSet = true;
    }
  });
  return {
    lineRows,
    subtotalMinor,
    vatMinor,
    totalMinor: subtotalMinor + vatMinor,
    headerVatRate,
  };
}

export async function createInvoice(
  formData: FormData,
): Promise<InvoiceActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseInvoiceSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const input = parsed.data;

  // Decode + validate line items (which arrive as a JSON-encoded string).
  let linesRaw: unknown;
  try {
    linesRaw = JSON.parse(input.linesJson);
  } catch {
    return { error: "app.errors.invalidInput" };
  }
  const linesParsed = z.array(lineSchema).min(1).max(200).safeParse(linesRaw);
  if (!linesParsed.success) return { error: "app.errors.invalidInput" };
  const lines = linesParsed.data;

  // Load business inside RLS-scoped tx so the row visibility check is
  // enforced by Postgres. Throws if the business is not visible to the
  // current user — surfaced to the operator as invalidInput rather than
  // leaking a "permission denied" message.
  const businessRow = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, input.businessId), isNull(businesses.deletedAt)))
      .limit(1)) as Array<typeof businesses.$inferSelect>;
    return rows[0] ?? null;
  });
  if (!businessRow) return { error: "app.errors.invalidInput" };

  const totals = aggregateInvoiceTotals(lines);

  // Allocation threshold step-up: amounts > active threshold require
  // a fresh proof of presence (Plan v4 Risk #10 / council C-2). The
  // payload hash binds the grant to the invoice's identity so a step-up
  // for invoice A cannot be replayed for invoice B.
  const issueDate = new Date(`${input.issueDate}T00:00:00Z`);
  const needsAllocation = requiresAllocationNumber(
    issueDate,
    totals.totalMinor,
    businessRow.vatStatus,
  );
  if (needsAllocation) {
    try {
      await requireFreshSession({
        op: "invoice.issue_high_value",
        payloadHash: computePayloadHash({
          businessId: businessRow.id,
          invoiceType: input.invoiceType,
          issueDate: input.issueDate,
          totalMinor: totals.totalMinor.toString(),
          // Bind to currency so a hash for a USD draft doesn't release
          // its ILS sibling at the same magnitude.
          currency: input.currency,
        }),
      });
    } catch (err) {
      if (err instanceof StepUpRequired) {
        return { error: "app.errors.stepUpRequired" };
      }
      throw err;
    }
  }

  const provider = selectProvider(businessRow);

  const id = await withUser(me.appUserId, async (tx) => {
    const issueInput: InvoiceIssueInput = {
      tx,
      business: businessRow,
      actorUserId: me.appUserId,
      invoiceType: input.invoiceType,
      issueDate: input.issueDate,
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      currency: input.currency,
      ...(input.fxRate !== undefined ? { fxRate: input.fxRate } : {}),
      subtotalMinor: totals.subtotalMinor,
      vatMinor: totals.vatMinor,
      totalMinor: totals.totalMinor,
      vatRate: totals.headerVatRate,
      ...(input.notesHe ? { notesHe: input.notesHe } : {}),
      ...(input.notesEn ? { notesEn: input.notesEn } : {}),
      lines: totals.lineRows,
    };

    const result = await provider.issueInvoice(issueInput);

    // If the operator supplied a manual allocation number (pasted from
    // the SHAAM portal), persist it now in the same tx — keeps the row
    // and its allocation status consistent.
    if (input.allocationNumber && needsAllocation) {
      await tx
        .update(invoices)
        .set({
          allocationNumber: input.allocationNumber,
          allocationStatus: "manual_pasted",
        })
        .where(eq(invoices.id, result.invoiceId));
    }
    return result.invoiceId;
  });

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  return { ok: true, id };
}

// Edits to committed invoices are forbidden by IL no-gap policy. This
// action is included for API parity but currently always returns
// "immutable" — the UI is expected to hide the edit affordance for any
// row that already has a sequential_number. Once Phase D adds an
// explicit `draft` lifecycle state, the body below lights up.
export async function updateDraftInvoice(
  formData: FormData,
): Promise<InvoiceActionResult> {
  const me = await requireCurrentUser();
  const parsed = baseInvoiceSchema.safeParse(parseFormData(formData));
  if (!parsed.success || !parsed.data.id) {
    return { error: "app.errors.invalidInput" };
  }
  const id = parsed.data.id!;

  const isDraft = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx
      .select({
        cancelledAt: invoices.cancelledAt,
        sequentialNumber: invoices.sequentialNumber,
      })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)) as Array<{
      cancelledAt: Date | null;
      sequentialNumber: number;
    }>;
    const r = rows[0];
    if (!r) return false;
    // We treat a row with cancelledAt set OR a sequential number issued
    // as committed/immutable. Until Phase D introduces a real draft
    // state, every internally-issued invoice ends up immutable here.
    return r.cancelledAt === null && r.sequentialNumber === 0;
  });

  if (!isDraft) return { error: "app.errors.invoiceImmutable" };

  // Future: apply parsed fields to the row.
  return { error: "app.errors.invoiceImmutable" };
}

const cancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
  issueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// Cancel = emit a credit_note linked via parent_invoice_id. We NEVER
// hard-delete invoices. Provider.cancelInvoice() handles the parent
// cancelledAt flip + credit note insert + sequence allocation + audit
// row in a single tx.
export async function cancelInvoice(
  formData: FormData,
): Promise<InvoiceActionResult> {
  const me = await requireCurrentUser();
  const parsed = cancelSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const { id, reason } = parsed.data;
  const issueDate =
    parsed.data.issueDate ?? new Date().toISOString().slice(0, 10);

  // Pre-flight: load the parent's business so the provider has a Business
  // row to operate against. The cancel action is itself a high-impact
  // operation but is not value-thresholded — the parent was already
  // step-up gated at issue time if its total crossed the threshold.
  const businessRow = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT b.* FROM businesses b
          JOIN invoices i ON i.business_id = b.id
          WHERE i.id = ${id}::uuid AND b.deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<typeof businesses.$inferSelect>;
    return rows[0] ?? null;
  });
  if (!businessRow) return { error: "app.errors.invalidInput" };

  const provider = selectProvider(businessRow);

  const creditNoteId = await withUser(me.appUserId, async (tx) => {
    const result = await provider.cancelInvoice({
      tx,
      business: businessRow,
      actorUserId: me.appUserId,
      parentInvoiceId: id,
      reason,
      issueDate,
    });
    return result.creditNoteInvoiceId;
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  revalidatePath(`/invoices/${creditNoteId}`);
  revalidatePath("/dashboard");
  return { ok: true, id: creditNoteId };
}

const deleteSchema = z.object({ id: z.string().uuid() });

// Convenience redirect-helper for the legacy delete affordance. In the
// invoice domain "delete" maps to "cancel via credit note" — we don't
// expose a separate hard-delete. This wrapper exists so the list UI can
// post a single delete-shaped form and we still emit a credit note.
export async function softDeleteInvoice(
  formData: FormData,
): Promise<InvoiceActionResult | void> {
  const parsed = deleteSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "app.errors.invalidInput" };
  const reason = String(formData.get("reason") ?? "operator_cancellation");
  const cancelForm = new FormData();
  cancelForm.set("id", parsed.data.id);
  cancelForm.set("reason", reason);
  const result = await cancelInvoice(cancelForm);
  if ("error" in result) return result;
  redirect({ href: "/invoices", locale: await getLocale() });
}

// Lightweight read helper for the credit-note suppression check used by
// the edit page; keeps SQL in the action surface rather than the page
// component.
export async function getInvoiceLockState(invoiceId: string): Promise<{
  sequentialNumber: number;
  cancelledAt: Date | null;
} | null> {
  const me = await requireCurrentUser();
  return withUser(me.appUserId, async (tx) => {
    const rows = (await tx
      .select({
        sequentialNumber: invoices.sequentialNumber,
        cancelledAt: invoices.cancelledAt,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)) as Array<{
      sequentialNumber: number;
      cancelledAt: Date | null;
    }>;
    return rows[0] ?? null;
  });
}

// Used internally by the edit/detail pages to read line items + parent
// row for display. Returns null if the invoice is not visible to the
// caller (RLS handled inside withUser).
export async function loadInvoiceForDisplay(invoiceId: string): Promise<{
  invoice: typeof invoices.$inferSelect;
  lines: Array<typeof invoiceLineItems.$inferSelect>;
} | null> {
  const me = await requireCurrentUser();
  return withUser(me.appUserId, async (tx) => {
    const rows = (await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)) as Array<typeof invoices.$inferSelect>;
    const head = rows[0];
    if (!head) return null;
    const lines = (await tx
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))) as Array<
      typeof invoiceLineItems.$inferSelect
    >;
    return { invoice: head, lines };
  });
}

// Re-export the active threshold so client components can mirror the
// server-side rule without re-reading the table in two places.
export async function getActiveAllocationThreshold(
  isoDate: string,
): Promise<{ amountMinor: string }> {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const amt = activeThresholdAt(d);
  return { amountMinor: amt.toString() };
}
