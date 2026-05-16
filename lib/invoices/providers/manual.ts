// Manual (internal) invoice provider.
//
// Authoritative reference implementation: every other provider (Green
// Invoice / iCount / EZCount / payment-processors / direct SHAAM) MUST
// produce the same DB-side outcome — invoice row + line items + sequence
// audit — only swapping who owns the numbering.
//
// `issueInvoice` flow:
//   1. Call `nextInvoiceSequence` inside the caller's tx (advisory-lock
//      backed, gap-free).
//   2. Decide `allocation_required_at_issue` via the dated threshold rule.
//      Set `allocation_status` accordingly:
//        - osek_patur / under threshold → 'not_required'
//        - over threshold              → 'required_not_assigned'
//   3. INSERT invoice + line items.
//   4. Return the new invoice id + sequence number.
//
// `cancelInvoice` issues a credit_note linked via `parent_invoice_id`.
// We NEVER hard-delete invoices (Plan v4 § Locked Decisions).
//
// `listInvoices` provides paginated read for Phase C CRUD UI.
//
// No external HTTP calls — pure DB.

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  invoices,
  invoiceLineItems,
} from "@/db/schema/invoicing";
import { nextInvoiceSequence } from "@/lib/invoices/sequential";
import {
  requiresAllocationNumber,
  type BusinessVatStatus,
} from "@/lib/invoices/allocationThreshold";
import type {
  AllocationStatus,
  IInvoiceProvider,
  InvoiceCancelInput,
  InvoiceCancelResult,
  InvoiceIssueInput,
  InvoiceIssueResult,
  InvoiceListInput,
  InvoiceListResult,
  InvoiceListRow,
} from "@/lib/invoices/providers/IInvoiceProvider";

function computeAllocationStatus(args: {
  issueDate: Date;
  totalMinor: bigint;
  vatStatus: BusinessVatStatus;
}): {
  required: boolean;
  status: AllocationStatus;
} {
  const required = requiresAllocationNumber(
    args.issueDate,
    args.totalMinor,
    args.vatStatus,
  );
  return {
    required,
    status: required ? "required_not_assigned" : "not_required",
  };
}

async function issueInvoiceImpl(
  input: InvoiceIssueInput,
): Promise<InvoiceIssueResult> {
  const {
    tx,
    business,
    actorUserId,
    invoiceType,
    issueDate,
    dueDate,
    clientId,
    parentInvoiceId,
    currency,
    fxRate,
    subtotalMinor,
    vatMinor,
    totalMinor,
    vatRate,
    notesHe,
    notesEn,
    lines,
  } = input;

  // Defensive: enforce subtotal + vat === total inside the provider
  // even though the caller is expected to compute correctly. Float drift
  // is the most common source of bugs and the check is cheap.
  if (subtotalMinor + vatMinor !== totalMinor) {
    throw new Error(
      `manual.issueInvoice: subtotal (${subtotalMinor}) + vat (${vatMinor}) ` +
        `does not equal total (${totalMinor})`,
    );
  }

  const sequentialNumber = await nextInvoiceSequence({
    tx,
    businessId: business.id,
    invoiceType,
    actorUserId,
  });

  const { required, status } = computeAllocationStatus({
    issueDate: new Date(`${issueDate}T00:00:00Z`),
    totalMinor,
    vatStatus: business.vatStatus,
  });

  const inserted = await tx
    .insert(invoices)
    .values({
      businessId: business.id,
      ...(clientId !== undefined ? { clientId } : {}),
      invoiceType,
      sequentialNumber,
      ...(parentInvoiceId !== undefined ? { parentInvoiceId } : {}),
      issueDate,
      ...(dueDate !== undefined ? { dueDate } : {}),
      subtotalMinor,
      vatMinor,
      totalMinor,
      vatRate,
      currencyAtIssue: currency,
      ...(fxRate !== undefined ? { fxRateAtIssue: fxRate } : {}),
      allocationStatus: status,
      allocationRequiredAtIssue: required,
      providerKind: "internal" as const,
      ...(notesHe !== undefined ? { notesHe } : {}),
      ...(notesEn !== undefined ? { notesEn } : {}),
    })
    .returning({ id: invoices.id });

  const invoiceId = inserted[0]?.id;
  if (!invoiceId) {
    throw new Error("manual.issueInvoice: failed to insert invoice");
  }

  if (lines.length > 0) {
    await tx.insert(invoiceLineItems).values(
      lines.map((line) => ({
        invoiceId,
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        vatRate: line.vatRate,
        lineTotalMinor: line.lineTotalMinor,
      })),
    );
  }

  return {
    invoiceId,
    sequentialNumber,
    allocationStatus: status,
  };
}

async function cancelInvoiceImpl(
  input: InvoiceCancelInput,
): Promise<InvoiceCancelResult> {
  const { tx, business, actorUserId, parentInvoiceId, reason, issueDate } =
    input;

  // Load the parent so we can mirror its totals into the credit note.
  const parentRows = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, parentInvoiceId))
    .limit(1);
  const parent = parentRows[0];
  if (!parent) {
    throw new Error(
      `manual.cancelInvoice: parent invoice ${parentInvoiceId} not found`,
    );
  }
  if (parent.businessId !== business.id) {
    throw new Error(
      "manual.cancelInvoice: parent invoice belongs to a different business",
    );
  }
  if (parent.cancelledAt !== null) {
    throw new Error("manual.cancelInvoice: parent invoice already cancelled");
  }

  // Mark the parent cancelled — this frees the sequence slot per the
  // conditional unique index (cancelled_at IS NULL in WHERE).
  await tx
    .update(invoices)
    .set({ cancelledAt: new Date(), cancellationReason: reason })
    .where(eq(invoices.id, parentInvoiceId));

  // Issue a credit note that negates the parent. Same currency / fx
  // rate / VAT rate so the bookkeeping reverses cleanly.
  const result = await issueInvoiceImpl({
    tx,
    business,
    actorUserId,
    invoiceType: "credit_note",
    issueDate,
    ...(parent.clientId !== null ? { clientId: parent.clientId } : {}),
    parentInvoiceId,
    currency: parent.currencyAtIssue,
    ...(parent.fxRateAtIssue !== null
      ? { fxRate: parent.fxRateAtIssue }
      : {}),
    subtotalMinor: -parent.subtotalMinor,
    vatMinor: -parent.vatMinor,
    totalMinor: -parent.totalMinor,
    vatRate: parent.vatRate,
    notesHe: `ביטול חשבונית ${parent.sequentialNumber}: ${reason}`,
    notesEn: `Cancellation of invoice ${parent.sequentialNumber}: ${reason}`,
    lines: [], // line-level reversal is computed at PDF render time
  });

  return {
    creditNoteInvoiceId: result.invoiceId,
    creditNoteSequentialNumber: result.sequentialNumber,
  };
}

async function listInvoicesImpl(
  input: InvoiceListInput,
): Promise<InvoiceListResult> {
  const { tx, businessId, clientId, issueDateFrom, issueDateTo } = input;
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  const filters = [eq(invoices.businessId, businessId)];
  if (clientId) filters.push(eq(invoices.clientId, clientId));
  if (issueDateFrom)
    filters.push(gte(invoices.issueDate, issueDateFrom));
  if (issueDateTo) filters.push(lte(invoices.issueDate, issueDateTo));

  const where = filters.length === 1 ? filters[0]! : and(...filters)!;

  const rowsRaw = await tx
    .select({
      id: invoices.id,
      sequentialNumber: invoices.sequentialNumber,
      invoiceType: invoices.invoiceType,
      issueDate: invoices.issueDate,
      totalMinor: invoices.totalMinor,
      currencyAtIssue: invoices.currencyAtIssue,
      allocationStatus: invoices.allocationStatus,
      cancelledAt: invoices.cancelledAt,
      clientId: invoices.clientId,
    })
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.issueDate), desc(invoices.sequentialNumber))
    .limit(limit)
    .offset(offset);

  const countRows = (await tx.execute(
    sql`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = ${businessId}`,
  )) as unknown as Array<{ n: number }>;
  const total = countRows[0]?.n ?? 0;

  const rows: InvoiceListRow[] = rowsRaw.map((r) => ({
    id: r.id,
    sequentialNumber: r.sequentialNumber,
    invoiceType: r.invoiceType,
    issueDate: r.issueDate,
    totalMinor: r.totalMinor,
    currencyAtIssue: r.currencyAtIssue,
    allocationStatus: r.allocationStatus,
    cancelledAt: r.cancelledAt,
    clientId: r.clientId,
  }));

  return { rows, total };
}

export const manualInvoiceProvider: IInvoiceProvider = {
  kind: "internal",
  issueInvoice: issueInvoiceImpl,
  cancelInvoice: cancelInvoiceImpl,
  listInvoices: listInvoicesImpl,
};
