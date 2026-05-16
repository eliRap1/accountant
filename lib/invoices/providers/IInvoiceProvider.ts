// Invoice-provider abstraction.
//
// AccounTech supports four issuance paths (Plan v4 § Invoice Clearance):
//   - internal  (we generate the sequence + own the SHAAM allocation flow)
//   - partner   (greenInvoice / iCount / ezCount / hyp / grow / payplus —
//                they own numbering + allocation, we sync results)
//   - processor (payment-processor sync — same as partner from the
//                provider point of view but driven by a different cron)
//   - direct_shaam (we hold the SHAAM cert and call SHAAM directly —
//                   future, post-certification)
//
// `selectProvider(business)` currently returns the manual provider
// unconditionally. Phase F.4 swaps it out when partner credentials exist.

import type {
  InvoiceType,
  DrizzleTx,
} from "@/lib/invoices/sequential";
import type {
  allocationStatusEnum,
  providerKindEnum,
} from "@/db/schema/invoicing";
import type { businesses } from "@/db/schema/businesses";

export type ProviderKind = (typeof providerKindEnum.enumValues)[number];
export type AllocationStatus =
  (typeof allocationStatusEnum.enumValues)[number];

// `Business` is the row shape used by the provider — not the full Drizzle
// row, since providers don't need internal columns like `created_at`.
// Aligned to the schema where it matters (vatStatus / vatId / id).
export type Business = typeof businesses.$inferSelect;

export type InvoiceLineInput = {
  position: number;
  description: string;
  /** Quantity as decimal string for arbitrary precision (matches numeric col). */
  quantity: string;
  /** Per-unit price in minor units (אגורות). */
  unitPriceMinor: bigint;
  /** VAT rate as decimal % (e.g. "18.00"). */
  vatRate: string;
  /** Pre-computed line total in minor units (qty * unit_price, no VAT). */
  lineTotalMinor: bigint;
};

export type InvoiceIssueInput = {
  tx: DrizzleTx;
  business: Business;
  /** App user id of the operator issuing — used for audit rows. */
  actorUserId: string;
  invoiceType: InvoiceType;
  /** ISO date string YYYY-MM-DD for the issue date. */
  issueDate: string;
  /** Optional ISO date string for due date. */
  dueDate?: string;
  clientId?: string;
  /** Parent invoice id for credit_note / debit_note. */
  parentInvoiceId?: string;
  currency: string;
  /** Rate against ILS — null for ILS-only invoices. */
  fxRate?: string;
  /** Aggregate subtotal in minor units. */
  subtotalMinor: bigint;
  /** Aggregate VAT in minor units. */
  vatMinor: bigint;
  /** Aggregate total in minor units (subtotal + VAT). Must equal sum of line totals + VAT. */
  totalMinor: bigint;
  /** Headline VAT rate (e.g. "18.00"). Lines may individually override. */
  vatRate: string;
  notesHe?: string;
  notesEn?: string;
  lines: InvoiceLineInput[];
};

export type InvoiceIssueResult = {
  invoiceId: string;
  sequentialNumber: number;
  allocationStatus: AllocationStatus;
  /** Allocation number once assigned (manual/partner/processor/direct paths). */
  allocationNumber?: string;
};

export type InvoiceCancelInput = {
  tx: DrizzleTx;
  business: Business;
  actorUserId: string;
  /** Original invoice to cancel — we never hard-delete. */
  parentInvoiceId: string;
  /** Required reason text — surfaces on the credit note PDF. */
  reason: string;
  /** ISO date string for the credit note's issue date. */
  issueDate: string;
};

export type InvoiceCancelResult = {
  /** ID of the credit-note invoice that cancels the parent. */
  creditNoteInvoiceId: string;
  creditNoteSequentialNumber: number;
};

export type InvoiceListInput = {
  tx: DrizzleTx;
  businessId: string;
  /** Optional client filter. */
  clientId?: string;
  /** Optional issue-date range, inclusive. */
  issueDateFrom?: string;
  issueDateTo?: string;
  /** Optional pagination — default 50. */
  limit?: number;
  offset?: number;
};

export type InvoiceListRow = {
  id: string;
  sequentialNumber: number;
  invoiceType: InvoiceType;
  issueDate: string;
  totalMinor: bigint;
  currencyAtIssue: string;
  allocationStatus: AllocationStatus;
  cancelledAt: Date | null;
  clientId: string | null;
};

export type InvoiceListResult = {
  rows: InvoiceListRow[];
  total: number;
};

export type ReceiptSyncInput = {
  tx: DrizzleTx;
  businessId: string;
  /** ISO timestamp; pull events since this cursor. */
  since: string;
};

export type ReceiptSyncResult = {
  /** How many receipt rows were inserted / updated. */
  upserted: number;
  /** Updated cursor to persist on processor_sync_credentials. */
  nextCursor: string;
};

export interface IInvoiceProvider {
  kind: ProviderKind;
  issueInvoice(input: InvoiceIssueInput): Promise<InvoiceIssueResult>;
  cancelInvoice(input: InvoiceCancelInput): Promise<InvoiceCancelResult>;
  /** Optional list — internal provider implements; partner providers stub. */
  listInvoices?(input: InvoiceListInput): Promise<InvoiceListResult>;
  /** Optional receipt sync — only the processor providers implement. */
  syncReceipts?(input: ReceiptSyncInput): Promise<ReceiptSyncResult>;
}

import { manualInvoiceProvider } from "@/lib/invoices/providers/manual";

/**
 * Return the active provider for `business`. Currently always the manual
 * (internal) provider — F.4 will inspect business-level credentials and
 * return the matching partner / processor / direct provider.
 *
 * The function is intentionally synchronous + side-effect free so it can
 * be called from anywhere without dragging async into call sites.
 */
export function selectProvider(_business: Business): IInvoiceProvider {
  return manualInvoiceProvider;
}
