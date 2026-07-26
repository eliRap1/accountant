// Pre-computed advisor context block — ≤ 1000 chars, PII-redacted.
//
// `generateSnapshotContext(userId, businessId?)` reads:
//   - Active business profile (vat_status, entity_type — NO vat_id text).
//   - Last 12-month income/expense totals.
//   - Current 2-month VAT period payable estimate.
//   - מקדמות paid YTD + assigned rate.
//   - Open invoice overdue count.
//   - Active חשבונית-ישראל allocation threshold.
//
// Returns a compact serialised string (NOT JSON — natural-language
// labels keep token cost low and let the model index the fields
// reliably). The disclaimer is always present at the end.

import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import {
  rulesForYear,
  activeAllocationThresholdMinor,
} from "@/lib/tax/il/runEngineForUser";
import { DEFAULT_DISCLAIMER } from "@/lib/ai/prompt";
import { getSpendingByCategory } from "@/lib/aggregations/spendingByCategory";

const MAX_SNAPSHOT_CHARS = 1000;

type BizRow = {
  id: string;
  legal_name: string;
  vat_status: string;
  entity_type: string;
  advance_tax_rate_pct: string | null;
  default_currency: string;
};

type IeRow = {
  direction: string;
  total_minor: string;
};

type VatPeriodAggRow = {
  vat_collected_minor: string;
  vat_paid_minor: string;
};

type OverdueRow = {
  overdue_count: string;
  overdue_minor: string;
};

type AdvancePaidRow = {
  paid_ytd_minor: string;
};

function shilling(n: bigint): string {
  // ₪ in major units, comma-grouped. 1234500n -> "₪12,345".
  const major = Number(n) / 100;
  return `₪${Math.round(major).toLocaleString("en-US")}`;
}

/**
 * Mask anything that looks like raw IL identifiers in the legal name.
 * (We never put vat_id in the snapshot, but defensive in case the
 * legal_name contains a number — e.g. "Solo 514321987 LTD".)
 */
function maskName(name: string): string {
  return name.replace(/\d{9}/g, "[masked]").slice(0, 40);
}

export type SnapshotContext = {
  text: string;
  /** True when the user has a business; false → empty/no-op snapshot. */
  hasBusiness: boolean;
  /** Cardinality of the inputs the snapshot saw — for /debug surfaces. */
  inputs: {
    incomeMinor: bigint;
    expensesMinor: bigint;
    vatPayableThisPeriodMinor: bigint;
    overdueInvoiceCount: number;
    overdueInvoiceTotalMinor: bigint;
    advanceTaxPaidYtdMinor: bigint;
  };
};

export async function generateSnapshotContext(
  userId: string,
  opts: { businessId?: string; now?: Date } = {},
): Promise<SnapshotContext> {
  const now = opts.now ?? new Date();
  const year = now.getUTCFullYear();
  const rules = rulesForYear(year);
  const yearStartIso = `${year}-01-01`;
  const yearEndIso = `${year}-12-31`;
  const monthIdx = now.getUTCMonth();
  const periodStartMonth = Math.floor(monthIdx / 2) * 2;
  const periodStartIso = new Date(Date.UTC(year, periodStartMonth, 1))
    .toISOString()
    .slice(0, 10);
  const periodEndIso = new Date(Date.UTC(year, periodStartMonth + 2, 1))
    .toISOString()
    .slice(0, 10);

  return withUser(userId, async (tx) => {
    let business: BizRow | null = null;
    if (opts.businessId) {
      const rows = (await tx.execute(
        sql`SELECT id, legal_name, vat_status::text, entity_type::text,
                   advance_tax_rate_pct, default_currency
            FROM businesses
            WHERE id = ${opts.businessId} AND deleted_at IS NULL LIMIT 1`,
      )) as unknown as BizRow[];
      business = rows[0] ?? null;
    } else {
      const rows = (await tx.execute(
        sql`SELECT id, legal_name, vat_status::text, entity_type::text,
                   advance_tax_rate_pct, default_currency
            FROM businesses
            WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as BizRow[];
      business = rows[0] ?? null;
    }

    const activeThresholdMinor = activeAllocationThresholdMinor(rules, now);

    if (!business) {
      const text = withinLimit(
        [
          "Snapshot: no active business onboarded yet.",
          `Current חשבונית-ישראל threshold: ${shilling(activeThresholdMinor)} (pre-VAT).`,
          DEFAULT_DISCLAIMER.he,
          DEFAULT_DISCLAIMER.en,
        ].join("\n"),
      );
      return {
        text,
        hasBusiness: false,
        inputs: {
          incomeMinor: 0n,
          expensesMinor: 0n,
          vatPayableThisPeriodMinor: 0n,
          overdueInvoiceCount: 0,
          overdueInvoiceTotalMinor: 0n,
          advanceTaxPaidYtdMinor: 0n,
        },
      };
    }

    const ieRows = (await tx.execute(
      sql`SELECT direction::text, COALESCE(SUM(amount_minor),0)::text AS total_minor
          FROM transactions
          WHERE business_id = ${business.id}
            AND txn_date >= ${yearStartIso}::date
            AND txn_date <= ${yearEndIso}::date
          GROUP BY direction`,
    )) as unknown as IeRow[];
    let incomeMinor = 0n;
    let expensesMinor = 0n;
    for (const r of ieRows) {
      const v = BigInt(r.total_minor);
      if (r.direction === "income") incomeMinor = v;
      else if (r.direction === "expense") expensesMinor = v;
    }

    const vatCollected = (await tx.execute(
      sql`SELECT COALESCE(SUM(vat_minor),0)::text AS vat_collected_minor,
                 '0'::text AS vat_paid_minor
          FROM invoices
          WHERE business_id = ${business.id}
            AND cancelled_at IS NULL
            AND issue_date >= ${periodStartIso}::date
            AND issue_date <  ${periodEndIso}::date`,
    )) as unknown as VatPeriodAggRow[];

    const vatPaid = (await tx.execute(
      sql`SELECT '0'::text AS vat_collected_minor,
                 COALESCE(SUM(vat_recoverable_minor),0)::text AS vat_paid_minor
          FROM receipts
          WHERE business_id = ${business.id}
            AND status = 'approved'
            AND parsed_date >= ${periodStartIso}::date
            AND parsed_date <  ${periodEndIso}::date`,
    )) as unknown as VatPeriodAggRow[];

    let vatPayableThisPeriodMinor =
      BigInt(vatCollected[0]?.vat_collected_minor ?? "0") -
      BigInt(vatPaid[0]?.vat_paid_minor ?? "0");
    if (vatPayableThisPeriodMinor < 0n) vatPayableThisPeriodMinor = 0n;

    const overdueRows = (await tx.execute(
      sql`SELECT COUNT(*)::text AS overdue_count,
                 COALESCE(SUM(total_minor),0)::text AS overdue_minor
          FROM invoices
          WHERE business_id = ${business.id}
            AND cancelled_at IS NULL
            AND due_date IS NOT NULL
            AND due_date < ${now.toISOString().slice(0, 10)}::date
            AND invoice_type IN ('tax_invoice','tax_invoice_receipt')`,
    )) as unknown as OverdueRow[];
    const overdueCount = Number(overdueRows[0]?.overdue_count ?? "0");
    const overdueTotalMinor = BigInt(overdueRows[0]?.overdue_minor ?? "0");

    // Note: tax_advances table is in Plan v4 Layer 3 (filings); when it's
    // not yet present this query falls through to 0. Wrapped in a guarded
    // try/catch so this module stays usable mid-schema-rollout.
    let advanceTaxPaidYtdMinor = 0n;
    try {
      const rows = (await tx.execute(
        sql`SELECT COALESCE(SUM(amount_due_minor),0)::text AS paid_ytd_minor
            FROM tax_advances
            WHERE business_id = ${business.id}
              AND paid_at IS NOT NULL
              AND period_start >= ${yearStartIso}::date`,
      )) as unknown as AdvancePaidRow[];
      advanceTaxPaidYtdMinor = BigInt(rows[0]?.paid_ytd_minor ?? "0");
    } catch {
      // tax_advances not migrated yet — leave as 0.
      advanceTaxPaidYtdMinor = 0n;
    }

    const advanceRatePct = business.advance_tax_rate_pct
      ? Number(business.advance_tax_rate_pct)
      : null;

    const lines = [
      `Business: ${maskName(business.legal_name)} (${business.entity_type}/${business.vat_status})`,
      `YTD revenue: ${shilling(incomeMinor)}; YTD expenses: ${shilling(expensesMinor)}.`,
      `VAT this period (${periodStartIso}..${periodEndIso}): ${shilling(vatPayableThisPeriodMinor)} payable.`,
      overdueCount > 0
        ? `Overdue invoices: ${overdueCount} totalling ${shilling(overdueTotalMinor)}.`
        : `No overdue invoices.`,
      advanceRatePct != null
        ? `Advance-tax rate: ${advanceRatePct}%; YTD paid: ${shilling(advanceTaxPaidYtdMinor)}.`
        : `Advance-tax rate not yet assigned.`,
      `חשבונית-ישראל allocation threshold (active today): ${shilling(activeThresholdMinor)} pre-VAT.`,
      DEFAULT_DISCLAIMER.he,
      DEFAULT_DISCLAIMER.en,
    ];

    // Append top-3 expense categories last 30 days — supports the AI tool
    // "what did I spend on X" pattern. Failure here must not break the
    // snapshot (categories are nice-to-have).
    let topCatLine: string | null = null;
    try {
      const cats = await getSpendingByCategory(userId, { now });
      const top3 = cats.rows.slice(0, 3);
      if (top3.length > 0) {
        topCatLine = `Top expense categories (last 30d): ${top3
          .map(
            (c) =>
              `${c.categoryName ?? "(uncategorised)"} ${shilling(BigInt(Math.round(c.totalMajor * 100)))}`,
          )
          .join(", ")}.`;
      }
    } catch {
      /* swallow — snapshot stays valid without this line. */
    }

    const allLines = topCatLine
      ? [...lines.slice(0, -2), topCatLine, ...lines.slice(-2)]
      : lines;

    return {
      text: withinLimit(allLines.join("\n")),
      hasBusiness: true,
      inputs: {
        incomeMinor,
        expensesMinor,
        vatPayableThisPeriodMinor,
        overdueInvoiceCount: overdueCount,
        overdueInvoiceTotalMinor: overdueTotalMinor,
        advanceTaxPaidYtdMinor,
      },
    };
  });
}

/** Clip to MAX_SNAPSHOT_CHARS, preserving the disclaimer suffix. */
function withinLimit(text: string): string {
  if (text.length <= MAX_SNAPSHOT_CHARS) return text;
  // Always keep the disclaimer block at the tail. Find the disclaimer
  // anchor and prepend trimmed-from-top body.
  const heAnchor = DEFAULT_DISCLAIMER.he;
  const idx = text.indexOf(heAnchor);
  if (idx < 0) return text.slice(0, MAX_SNAPSHOT_CHARS);
  const tail = text.slice(idx); // include disclaimer + everything after
  const allowance = MAX_SNAPSHOT_CHARS - tail.length - 1;
  if (allowance <= 0) return tail.slice(0, MAX_SNAPSHOT_CHARS);
  const head = text.slice(0, idx).slice(0, allowance);
  return `${head}\n${tail}`.slice(0, MAX_SNAPSHOT_CHARS);
}

export const SNAPSHOT_MAX_CHARS = MAX_SNAPSHOT_CHARS;
