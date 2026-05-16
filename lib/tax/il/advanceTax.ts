// מקדמות (advance tax) installment calculator.
//
// IL self-employed and ח.פ. businesses pay monthly מקדמות based on a
// percentage of revenue (turnover, NOT profit). The rate is assigned
// by the ITA at registration and updated annually — see businesses.
// advanceTaxRatePct in db/schema. Range per source publications:
// rules.advanceTaxRateRange.{min,max}Pct (currently 0.5%-7%).
//
// Per `kolzchut.org.il` + `orencpa.com`: payment is monthly OR bi-monthly
// depending on annual turnover (below ₪~280k = bi-monthly). We expose
// both via `period` parameter; UI form lets the user pick.

import type { AdvanceTaxInstallmentResult } from "./types";

const RATE_SCALE = 1_000_000n;

export type ComputeAdvanceTaxInstallmentArgs = {
  /** Period revenue (monthly or bi-monthly), minor units. */
  declaredRevenueMinor: bigint;
  /** ITA-assigned rate (0.04 == 4%). */
  ratePct: number;
};

export function computeAdvanceTaxInstallment({
  declaredRevenueMinor,
  ratePct,
}: ComputeAdvanceTaxInstallmentArgs): AdvanceTaxInstallmentResult {
  if (declaredRevenueMinor < 0n) {
    throw new Error("computeAdvanceTaxInstallment: declaredRevenueMinor must be non-negative");
  }
  if (ratePct < 0 || !Number.isFinite(ratePct)) {
    throw new Error("computeAdvanceTaxInstallment: ratePct must be a finite >= 0");
  }
  if (ratePct > 1) {
    throw new Error("computeAdvanceTaxInstallment: ratePct must be a fraction (0.04 = 4%)");
  }

  const scaled = BigInt(Math.round(ratePct * Number(RATE_SCALE)));
  const installmentMinor =
    (declaredRevenueMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;

  return {
    declaredRevenueMinor,
    ratePct,
    installmentMinor,
  };
}

/**
 * Sum prior installments + project the remaining months of the year at
 * `ratePct`. Returns the projected annual total. UI uses this for the
 * "מקדמות paid YTD / projected EOY" tile.
 */
export function projectAnnualAdvanceTax({
  paidYtdMinor,
  monthsRemaining,
  expectedMonthlyRevenueMinor,
  ratePct,
}: {
  paidYtdMinor: bigint;
  monthsRemaining: number;
  expectedMonthlyRevenueMinor: bigint;
  ratePct: number;
}): bigint {
  if (monthsRemaining < 0 || !Number.isInteger(monthsRemaining)) {
    throw new Error("projectAnnualAdvanceTax: monthsRemaining must be a non-negative integer");
  }
  const monthly = computeAdvanceTaxInstallment({
    declaredRevenueMinor: expectedMonthlyRevenueMinor,
    ratePct,
  }).installmentMinor;
  return paidYtdMinor + monthly * BigInt(monthsRemaining);
}
