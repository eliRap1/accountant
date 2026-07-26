// Phase D aggregate runner.
//
// `runFullTaxEngine(userId)` pulls 12 months of transactions + the
// current 2-month VAT period from the user's active business via
// `withUser` (RLS-scoped). Feeds them into every engine in this
// directory and returns a single `TaxEstimate` snapshot.
//
// The snapshot ALWAYS carries `disclaimer` — Phase D UI must render
// it on top of any tax surface and AI advisor messages append it as a
// suffix. See lib/ai/prompt.ts for the canonical text.

import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { computeIncomeTax } from "./incomeTax";
import { computeVat } from "./vat";
import { computeBituachLeumi } from "./bituachLeumi";
import { defaultCreditPoints } from "./creditPoints";
import { computeAdvanceTaxInstallment } from "./advanceTax";
import { IL_2026 } from "./rules-2026";
import rulesMeta from "./rules-2026.meta.json" with { type: "json" };
import type {
  IlRules,
  TaxDisclaimer,
  TaxEstimate,
  CreditPointInputs,
  VatStatus,
} from "./types";

/**
 * Canonical disclaimer text (he/en). Kept here AND mirrored in
 * `lib/ai/prompt.ts` so both rendering paths can import a single
 * source-of-truth string. `scripts/lint-legal-text.ts` enforces this
 * exact wording on every tax UI surface.
 */
export const DEFAULT_DISCLAIMER: TaxDisclaimer = {
  he: "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה",
  en: "Estimates only · Not tax advice · Consult a licensed accountant",
};

const RULES_BY_YEAR: Record<number, IlRules> = {
  2026: IL_2026,
};

/** Pick the active rule-set for `year` (defaults to the most recent). */
export function rulesForYear(year: number): IlRules {
  const rules = RULES_BY_YEAR[year];
  if (!rules) {
    // Fall back to latest available — Phase D ships with 2026 only.
    const max = Math.max(...Object.keys(RULES_BY_YEAR).map(Number));
    return RULES_BY_YEAR[max]!;
  }
  return rules;
}

/**
 * Locate the invoice-allocation threshold active for `forDate` (ISO).
 * Returns the most recent step whose `effectiveFrom <= forDate`.
 */
export function activeAllocationThresholdMinor(rules: IlRules, forDate: Date): bigint {
  const iso = forDate.toISOString().slice(0, 10);
  let active: bigint | null = null;
  for (const step of rules.invoiceAllocationThresholdsMinor) {
    if (step.effectiveFrom <= iso) {
      active = step.amountMinor;
    } else {
      break; // ordered array — anything after this is in the future
    }
  }
  // Defensive default to the highest published threshold if the array
  // somehow contains only future-dated steps.
  return active ?? rules.invoiceAllocationThresholdsMinor[0]?.amountMinor ?? 0n;
}

export type RunFullTaxEngineOptions = {
  /** Defaults to today; tests pass a fixture clock. */
  now?: Date;
  /** Override the rule-set year. */
  year?: number;
  /** Optional explicit business id (Phase D UI passes the active one). */
  businessId?: string;
  /** Inputs for credit points (if not provided, we use minimum baseline). */
  creditPointInputs?: CreditPointInputs;
};

type BusinessRow = {
  id: string;
  vat_status: VatStatus;
  advance_tax_rate_pct: string | null;
};

type IncomeExpenseRow = {
  direction: "income" | "expense" | "transfer";
  total_minor: string;
};

type VatPeriodRow = {
  vat_collected_minor: string;
  vat_paid_minor: string;
};

/**
 * Build a fully-populated `TaxEstimate` for the active business.
 *
 * Reads:
 *   - businesses.{id, vat_status, advance_tax_rate_pct}
 *   - transactions in the last 12 months (income/expense aggregates)
 *   - invoices in the current VAT period (collected VAT)
 *   - receipts in the current VAT period (paid/recoverable VAT)
 *
 * Returns a fully-formed `TaxEstimate` with `disclaimer` attached.
 */
export async function runFullTaxEngine(
  userId: string,
  opts: RunFullTaxEngineOptions = {},
): Promise<TaxEstimate> {
  const now = opts.now ?? new Date();
  const year = opts.year ?? now.getFullYear();
  const rules = rulesForYear(year);

  const yearStartIso = `${year}-01-01`;
  const yearEndIso = `${year}-12-31`;
  // Current 2-month VAT period: pair odd-month boundaries.
  // Jan-Feb / Mar-Apr / May-Jun / Jul-Aug / Sep-Oct / Nov-Dec.
  const monthIdx = now.getUTCMonth(); // 0-11
  const periodStartMonth = Math.floor(monthIdx / 2) * 2; // 0,2,4,6,8,10
  const periodStart = new Date(Date.UTC(year, periodStartMonth, 1));
  const periodEnd = new Date(Date.UTC(year, periodStartMonth + 2, 1)); // exclusive
  const periodStartIso = periodStart.toISOString().slice(0, 10);
  const periodEndIso = periodEnd.toISOString().slice(0, 10);

  return withUser(userId, async (tx) => {
    // Pick the active business: explicit option, else the most recent
    // not-deleted one owned by the user.
    let business: BusinessRow | null = null;
    if (opts.businessId) {
      const rows = (await tx.execute(
        sql`SELECT id, vat_status, advance_tax_rate_pct FROM businesses
            WHERE id = ${opts.businessId} AND deleted_at IS NULL LIMIT 1`,
      )) as unknown as BusinessRow[];
      business = rows[0] ?? null;
    } else {
      const rows = (await tx.execute(
        sql`SELECT id, vat_status, advance_tax_rate_pct FROM businesses
            WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as BusinessRow[];
      business = rows[0] ?? null;
    }

    if (!business) {
      return buildEmptyEstimate({
        rules,
        year,
        now,
        rulesVersion: rulesMeta.version,
        rulesHumanReviewed: rulesMeta.humanReviewed === true,
      });
    }

    // 12-month income + expense aggregates from transactions.
    const ieRows = (await tx.execute(
      sql`SELECT direction, COALESCE(SUM(amount_minor),0)::text AS total_minor
          FROM transactions
          WHERE business_id = ${business.id}
            AND txn_date >= ${yearStartIso}::date
            AND txn_date <= ${yearEndIso}::date
          GROUP BY direction`,
    )) as unknown as IncomeExpenseRow[];

    let incomeMinor = 0n;
    let expensesMinor = 0n;
    for (const r of ieRows) {
      const v = BigInt(r.total_minor);
      if (r.direction === "income") incomeMinor = v;
      else if (r.direction === "expense") expensesMinor = v;
    }

    // VAT collected this period (sum of invoices.vat_minor not cancelled).
    const vatCollectedRows = (await tx.execute(
      sql`SELECT COALESCE(SUM(vat_minor),0)::text AS vat_collected_minor,
                 '0'::text AS vat_paid_minor
          FROM invoices
          WHERE business_id = ${business.id}
            AND cancelled_at IS NULL
            AND issue_date >= ${periodStartIso}::date
            AND issue_date <  ${periodEndIso}::date`,
    )) as unknown as VatPeriodRow[];

    // VAT paid this period (sum of receipts.vat_recoverable_minor approved).
    const vatPaidRows = (await tx.execute(
      sql`SELECT '0'::text AS vat_collected_minor,
                 COALESCE(SUM(vat_recoverable_minor),0)::text AS vat_paid_minor
          FROM receipts
          WHERE business_id = ${business.id}
            AND status = 'approved'
            AND parsed_date >= ${periodStartIso}::date
            AND parsed_date <  ${periodEndIso}::date`,
    )) as unknown as VatPeriodRow[];

    const vatCollectedMinor = BigInt(vatCollectedRows[0]?.vat_collected_minor ?? "0");
    const vatPaidMinor = BigInt(vatPaidRows[0]?.vat_paid_minor ?? "0");
    const vatNetMinor = vatCollectedMinor - vatPaidMinor;
    const vatPayableThisPeriodMinor = vatNetMinor > 0n ? vatNetMinor : 0n;
    const vatRefundThisPeriodMinor = vatNetMinor < 0n ? -vatNetMinor : 0n;

    // Income tax — annualise the YTD net so mid-year users don't see
    // ~5/12 of the true bracketed bill. Take the larger of (days into
    // year, 1) to avoid divide-by-zero on Jan-1.
    const taxableYtdMinor =
      incomeMinor > expensesMinor ? incomeMinor - expensesMinor : 0n;
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const daysIntoYear = Math.max(
      1,
      Math.floor((now.getTime() - yearStart.getTime()) / 86_400_000),
    );
    const annualisedTaxableMinor =
      taxableYtdMinor > 0n
        ? (taxableYtdMinor * 365n) / BigInt(daysIntoYear)
        : 0n;
    const cpInputs = opts.creditPointInputs ?? minimalCreditPoints();
    const creditPoints = defaultCreditPoints(cpInputs).totalPoints;
    const incomeTax = computeIncomeTax({
      grossAnnualMinor: annualisedTaxableMinor,
      creditPoints,
      rules,
    });

    // Bituach Leumi monthly base — divide YTD by months elapsed (clamped
    // ≥1) so users get a realistic monthly average rather than YTD/12.
    const monthsElapsed = BigInt(Math.max(1, now.getUTCMonth() + 1));
    const monthlyGrossMinor =
      taxableYtdMinor > 0n ? taxableYtdMinor / monthsElapsed : 0n;
    const bituachLeumi = computeBituachLeumi({
      monthlyGrossMinor,
      employmentClass: "self_employed",
      rules,
    });

    // Advance tax monthly installment using business's assigned rate.
    let advanceTaxMonthlyInstallmentMinor: bigint | null = null;
    if (business.advance_tax_rate_pct != null) {
      const ratePct = Number(business.advance_tax_rate_pct) / 100;
      if (Number.isFinite(ratePct) && ratePct >= 0) {
        advanceTaxMonthlyInstallmentMinor = computeAdvanceTaxInstallment({
          declaredRevenueMinor: monthlyGrossMinor,
          ratePct,
        }).installmentMinor;
      }
    }

    return {
      disclaimer: DEFAULT_DISCLAIMER,
      year,
      rulesVersion: rulesMeta.version,
      rulesHumanReviewed: rulesMeta.humanReviewed === true,
      incomeMinor,
      expensesMinor,
      incomeTax,
      vatPayableThisPeriodMinor,
      vatRefundThisPeriodMinor,
      bituachLeumi,
      advanceTaxMonthlyInstallmentMinor,
      activeAllocationThresholdMinor: activeAllocationThresholdMinor(rules, now),
      advanceTaxRateRange: rules.advanceTaxRateRange,
    };
  });
}

function buildEmptyEstimate(args: {
  rules: IlRules;
  year: number;
  now: Date;
  rulesVersion: string;
  rulesHumanReviewed: boolean;
}): TaxEstimate {
  return {
    disclaimer: DEFAULT_DISCLAIMER,
    year: args.year,
    rulesVersion: args.rulesVersion,
    rulesHumanReviewed: args.rulesHumanReviewed,
    incomeMinor: 0n,
    expensesMinor: 0n,
    incomeTax: null,
    vatPayableThisPeriodMinor: 0n,
    vatRefundThisPeriodMinor: 0n,
    bituachLeumi: null,
    advanceTaxMonthlyInstallmentMinor: null,
    activeAllocationThresholdMinor: activeAllocationThresholdMinor(args.rules, args.now),
    advanceTaxRateRange: args.rules.advanceTaxRateRange,
  };
}

function minimalCreditPoints(): CreditPointInputs {
  return {
    isResident: true,
    isFemale: false,
    childrenUnder6: 0,
    childrenAged6To17: 0,
    childrenAged18: 0,
    isSingleParent: false,
    monthsSinceAliyah: null,
    reserveDutyDays: null,
    yearsSinceIdfDischarge: null,
  };
}

// Re-export for callers that just want VAT split / compute helpers.
export { computeVat };
