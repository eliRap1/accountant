// IL Income Tax engine — pure stepwise bracket walk.
//
// `computeIncomeTax` is a deterministic function: same input → same
// output, no DB / clock / network. The DB layer (`runEngineForUser`)
// gathers the inputs; this module just does the math.
//
// Methodology:
//   1. Walk brackets low → high.
//   2. For each bracket, compute the *slice* of income inside that
//      bracket's window (clamped to (from, to]).
//   3. Multiply slice × rate, accumulate gross tax. Convert percent
//      math via integer-safe scaling (bigint) — see `applyRate`.
//   4. Apply מס יסף surtax on the portion above its threshold.
//   5. Apply credit-points value as a refundable-but-floored credit:
//      net tax = max(0, gross_tax - credit_value).

import type {
  IlRules,
  IncomeTaxBracketBreakdown,
  IncomeTaxResult,
} from "./types";

// Percent-of-bigint without lossy float intermediates for moderate sizes.
// We scale the rate to 1e6 (six decimal places — plenty for 0.4727%-style
// effective rates) and integer-divide. Annual income in agorot is at most
// ~10^11 for any plausible Israeli taxpayer, so bigint × scaled rate fits
// in 2^63 with room to spare.
const RATE_SCALE = 1_000_000n;

function applyRate(amountMinor: bigint, ratePct: number): bigint {
  if (amountMinor <= 0n || ratePct === 0) return 0n;
  // Round-half-up at the agora level so we don't shave a perud per
  // bracket and underpay the bill by a few agorot on millions of ILS.
  const scaled = BigInt(Math.round(ratePct * Number(RATE_SCALE)));
  return (amountMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;
}

export type ComputeIncomeTaxArgs = {
  grossAnnualMinor: bigint;
  /** Total credit points to apply (e.g. 2.25 for a single male resident). */
  creditPoints: number;
  rules: IlRules;
};

export function computeIncomeTax({
  grossAnnualMinor,
  creditPoints,
  rules,
}: ComputeIncomeTaxArgs): IncomeTaxResult {
  if (grossAnnualMinor < 0n) {
    throw new Error("computeIncomeTax: grossAnnualMinor must be non-negative");
  }
  if (creditPoints < 0 || !Number.isFinite(creditPoints)) {
    throw new Error("computeIncomeTax: creditPoints must be a finite >= 0");
  }

  const breakdown: IncomeTaxBracketBreakdown[] = [];
  let runningFromMinor = 0n;
  let grossTaxMinor = 0n;
  let marginalRatePct = 0;

  for (const bracket of rules.incomeTaxBrackets) {
    const bracketTopMinor = bracket.upToMinor;
    const sliceTopMinor =
      bracketTopMinor === null
        ? grossAnnualMinor
        : grossAnnualMinor < bracketTopMinor
          ? grossAnnualMinor
          : bracketTopMinor;
    const sliceMinor = sliceTopMinor - runningFromMinor;
    if (sliceMinor > 0n) {
      const taxOnSliceMinor = applyRate(sliceMinor, bracket.ratePct);
      breakdown.push({
        rangeFromMinor: runningFromMinor,
        rangeToMinor: bracketTopMinor,
        ratePct: bracket.ratePct,
        slicedIncomeMinor: sliceMinor,
        taxOnSliceMinor,
      });
      grossTaxMinor += taxOnSliceMinor;
      marginalRatePct = bracket.ratePct;
    }
    // Stop walking once the income is exhausted within a bounded bracket.
    if (bracketTopMinor !== null && grossAnnualMinor <= bracketTopMinor) break;
    if (bracketTopMinor === null) break;
    runningFromMinor = bracketTopMinor;
  }

  // מס יסף surtax — additional flat rate above its threshold.
  let surtaxMinor = 0n;
  const surtaxFloor = rules.surtax.appliesAboveAnnualMinor;
  if (grossAnnualMinor > surtaxFloor) {
    const surtaxBase = grossAnnualMinor - surtaxFloor;
    surtaxMinor = applyRate(surtaxBase, rules.surtax.additionalRatePct);
    grossTaxMinor += surtaxMinor;
    // Top effective marginal incorporates the surtax (e.g. 47%+3%=50%).
    marginalRatePct = rules.surtax.additionalRatePct + marginalRatePct;
  }

  // Credit points. Fractional credits (e.g. 2.25) → scale by 1e4 to keep
  // precision without floating-point loss on the agorot column.
  const POINT_SCALE = 10_000n;
  const scaledPoints = BigInt(Math.round(creditPoints * Number(POINT_SCALE)));
  const creditValueMinor =
    (rules.creditPointValueAnnualMinor * scaledPoints) / POINT_SCALE;

  const netTaxMinor =
    grossTaxMinor > creditValueMinor ? grossTaxMinor - creditValueMinor : 0n;

  const effectiveRatePct =
    grossAnnualMinor > 0n
      ? Number(netTaxMinor) / Number(grossAnnualMinor)
      : -1;

  return {
    grossTaxMinor,
    creditValueMinor,
    netTaxMinor,
    marginalRatePct,
    effectiveRatePct,
    surtaxMinor,
    breakdown,
  };
}

// Convenience helper for UI: locate which bracket index `incomeAnnualMinor`
// lands in. -1 if zero / negative. Useful for "you're in the 31% bracket"
// callouts on the dashboard.
export function marginalBracketIndex(
  incomeAnnualMinor: bigint,
  rules: IlRules,
): number {
  if (incomeAnnualMinor <= 0n) return -1;
  let prevTop = 0n;
  for (let i = 0; i < rules.incomeTaxBrackets.length; i++) {
    const b = rules.incomeTaxBrackets[i]!;
    if (b.upToMinor === null) return i;
    if (incomeAnnualMinor <= b.upToMinor) return i;
    prevTop = b.upToMinor;
  }
  // Unreachable — final bracket is unbounded — but TS wants a return.
  void prevTop;
  return rules.incomeTaxBrackets.length - 1;
}
