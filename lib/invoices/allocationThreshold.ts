// IL invoice-allocation-number threshold rules.
//
// Background: under the ITA's חשבונית ישראל (Invoice Israel) program, B2B
// tax invoices above an annually-revised amount must be pre-authorised by
// the tax authority API before being issued. The threshold steps down each
// year as the program rolls out broadly:
//
//   - 2024 launch: ₪25,000
//   - 2025-01-01: ₪20,000
//   - 2026-01-01: ₪10,000
//   - 2026-06-01: ₪5,000  (accelerated per Plan v4 § Locked Decisions)
//   - 2027-01-01: ₪5,000  (statutory)
//
// We do NOT recompute the threshold for an already-issued invoice — once
// `invoices.allocation_required_at_issue` is frozen on insert, it stays.
// The function below is consulted only by the issuance path and by UI
// hints/badges (e.g. "this invoice will need an allocation number").
//
// Source: https://www.gov.il/he/service/request-assignment-number-for-tax-invoice
// (gov.il page timed out under automated fetch on 2026-05-16 — verify
// thresholds with a CPA before launch <verify-this>).
//
// Pure functions only — no DB access, no globals, no IO.

import type { vatStatusEnum } from "@/db/schema/businesses";

// Re-export the underlying enum value type for callers that don't want a
// direct schema import.
export type BusinessVatStatus = (typeof vatStatusEnum.enumValues)[number];

export type AllocationThresholdRule = {
  /** Effective start of the rule in IL local calendar (UTC midnight). */
  effectiveFrom: Date;
  /** Threshold in minor units (אגורות). Invoices > this amount require allocation. */
  amountMinor: bigint;
};

/**
 * Dated step rule. ORDER MATTERS — the implementation picks the latest
 * effective rule whose `effectiveFrom <= issueDate`. Keep ascending by date.
 *
 * If you add a future step, append it; never edit a historical row, since
 * historical issuance audits depend on these thresholds being stable.
 */
export const INVOICE_ALLOCATION_THRESHOLDS_MINOR: ReadonlyArray<AllocationThresholdRule> = [
  // ₪25,000 — 2024 launch step (system live May-2024; rule date 2024-01-01).
  // Source: rules-2026.ts § invoiceAllocationThresholdsMinor (cross-verified).
  {
    effectiveFrom: new Date(Date.UTC(2024, 0, 1)),
    amountMinor: 2_500_000n,
  },
  // ₪20,000 — 2025 step.
  {
    effectiveFrom: new Date(Date.UTC(2025, 0, 1)),
    amountMinor: 2_000_000n,
  },
  // ₪10,000 — 2026 step.
  {
    effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    amountMinor: 1_000_000n,
  },
  // ₪5,000 — accelerated 2026-06-01 (Plan v4 § Locked Decisions).
  {
    effectiveFrom: new Date(Date.UTC(2026, 5, 1)),
    amountMinor: 500_000n,
  },
];

/**
 * Returns the active threshold (in minor units) at `date`. If `date` is
 * before the earliest known rule, returns the earliest rule's amount —
 * the rules table predates the ITA program, so pre-2025 issuance is
 * effectively unbounded (return Infinity-equivalent: `2n ** 63n - 1n`).
 */
export function activeThresholdAt(date: Date): bigint {
  const t = date.getTime();
  let active: AllocationThresholdRule | null = null;
  for (const rule of INVOICE_ALLOCATION_THRESHOLDS_MINOR) {
    if (rule.effectiveFrom.getTime() <= t) {
      active = rule;
    } else {
      break;
    }
  }
  if (active === null) {
    // No rule yet applies — treat as effectively unlimited. We use a very
    // large bigint sentinel rather than throwing because callers (e.g.
    // historic data imports) need a defined answer for pre-2025 dates.
    return 9_223_372_036_854_775_807n;
  }
  return active.amountMinor;
}

/**
 * Decide whether an invoice requires a pre-issuance allocation number.
 *
 * Rules:
 *   - `osek_patur` is exempt (no VAT charged → no allocation requirement).
 *   - All other VAT statuses fall under the dated threshold.
 *   - Comparison is STRICTLY GREATER THAN — an invoice exactly at the
 *     threshold does NOT require allocation (consistent with the ITA's
 *     "amounts exceeding NIS X" wording on the gov.il service page).
 *
 * `amountMinor` MUST be the invoice's **subtotal (pre-VAT)** amount in
 * אגורות. The 2026 threshold (₪5,000 from 2026-06-01) is defined by the
 * ITA on the pre-VAT "סכום לפני מע"מ" amount. NEVER pass the grand total
 * (subtotal + VAT) — that would inflate the effective threshold by the
 * VAT factor and silently exempt invoices that should require allocation.
 */
export function requiresAllocationNumber(
  issueDate: Date,
  amountMinor: bigint,
  vatStatus: BusinessVatStatus,
): boolean {
  if (vatStatus === "osek_patur") return false;
  const threshold = activeThresholdAt(issueDate);
  return amountMinor > threshold;
}
