// Bituach Leumi (NI) + Bituach Bri'ut (health insurance) engine.
//
// Two-bracket schedule (low / high) with a monthly ceiling above which
// no contributions are due. The reduced-rate bracket applies to the
// slice of income up to ~60% of the average wage (₪7,703/mo for 2026
// per the BTL TikratAtzmaee circular); the regular rate applies to the
// slice between the threshold and the monthly ceiling (₪51,910/mo).
//
// `employmentClass` selects the rate table:
//   employee       → employeeContribMinor + employerContribMinor
//   self_employed  → selfContribMinor (NI + health combined)
//   owner_payroll  → same as employee (ח.פ. owner on a payroll); the
//                    employer half hits the company's books.

import type {
  BituachLeumiClassRates,
  BituachLeumiResult,
  EmploymentClass,
  IlRules,
} from "./types";

export type ComputeBituachLeumiArgs = {
  monthlyGrossMinor: bigint;
  employmentClass: EmploymentClass;
  rules: IlRules;
};

const RATE_SCALE = 1_000_000n;

function applyRate(amountMinor: bigint, ratePct: number): bigint {
  if (amountMinor <= 0n || ratePct === 0) return 0n;
  const scaled = BigInt(Math.round(ratePct * Number(RATE_SCALE)));
  return (amountMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;
}

function contribForClass(
  monthlyGrossMinor: bigint,
  rates: BituachLeumiClassRates,
): bigint {
  if (monthlyGrossMinor <= 0n) return 0n;
  const capped =
    monthlyGrossMinor > rates.monthlyCeilingMinor
      ? rates.monthlyCeilingMinor
      : monthlyGrossMinor;
  const lowSlice =
    capped > rates.lowBracketUpToMinor ? rates.lowBracketUpToMinor : capped;
  const highSlice =
    capped > rates.lowBracketUpToMinor ? capped - rates.lowBracketUpToMinor : 0n;
  return applyRate(lowSlice, rates.lowRatePct) + applyRate(highSlice, rates.highRatePct);
}

export function computeBituachLeumi({
  monthlyGrossMinor,
  employmentClass,
  rules,
}: ComputeBituachLeumiArgs): BituachLeumiResult {
  if (monthlyGrossMinor < 0n) {
    throw new Error("computeBituachLeumi: monthlyGrossMinor must be non-negative");
  }

  if (employmentClass === "self_employed") {
    const selfContribMinor = contribForClass(
      monthlyGrossMinor,
      rules.bituachLeumiSelfEmployed,
    );
    return {
      employeeContribMinor: 0n,
      employerContribMinor: 0n,
      selfContribMinor,
      totalContribMinor: selfContribMinor,
    };
  }

  // employee + owner_payroll share the same rate tables.
  const employeeContribMinor = contribForClass(
    monthlyGrossMinor,
    rules.bituachLeumiEmployee,
  );
  const employerContribMinor = contribForClass(
    monthlyGrossMinor,
    rules.bituachLeumiEmployer,
  );

  return {
    employeeContribMinor,
    employerContribMinor,
    selfContribMinor: 0n,
    totalContribMinor: employeeContribMinor + employerContribMinor,
  };
}

/**
 * Annualised projection — multiplies monthly contribution by 12. Naive
 * for variable-pay employees but useful for dashboard estimates.
 */
export function annualBituachLeumi(args: ComputeBituachLeumiArgs): BituachLeumiResult {
  const monthly = computeBituachLeumi(args);
  return {
    employeeContribMinor: monthly.employeeContribMinor * 12n,
    employerContribMinor: monthly.employerContribMinor * 12n,
    selfContribMinor: monthly.selfContribMinor * 12n,
    totalContribMinor: monthly.totalContribMinor * 12n,
  };
}
