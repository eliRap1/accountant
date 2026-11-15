import { describe, it, expect } from "vitest";
import { computeIncomeTax, marginalBracketIndex } from "@/lib/tax/il/incomeTax";
import { IL_2026 } from "@/lib/tax/il/rules-2026";

// Pure math fixtures against the 2026 (Amendment 288) bracket schedule.
// All numbers are minor units (agorot). 1 ILS = 100n.

describe("computeIncomeTax — IL 2026 brackets", () => {
  it("zero income produces zero net tax and -1 effective rate sentinel", () => {
    const r = computeIncomeTax({
      grossAnnualMinor: 0n,
      creditPoints: 0,
      rules: IL_2026,
    });
    expect(r.grossTaxMinor).toBe(0n);
    expect(r.netTaxMinor).toBe(0n);
    expect(r.effectiveRatePct).toBe(-1);
    expect(r.breakdown).toHaveLength(0);
  });

  it("single ₪10k/mo (₪120k/yr) — fits in the first two brackets", () => {
    // ₪120,000/yr -> 12_000_000n.
    // Bracket 1: ₪84,120 @ 10% -> 8,412 tax (₪).
    // Bracket 2: ₪35,880 @ 14% -> 5,023.20 → rounded 5,023.
    // Gross tax = ₪13,435.20 → 1_343_520n (with rounding).
    const r = computeIncomeTax({
      grossAnnualMinor: 12_000_000n,
      creditPoints: 0,
      rules: IL_2026,
    });
    expect(r.breakdown).toHaveLength(2);
    expect(r.breakdown[0]!.ratePct).toBe(0.10);
    expect(r.breakdown[0]!.slicedIncomeMinor).toBe(8_412_000n);
    expect(r.breakdown[0]!.taxOnSliceMinor).toBe(841_200n);
    expect(r.breakdown[1]!.ratePct).toBe(0.14);
    expect(r.breakdown[1]!.slicedIncomeMinor).toBe(3_588_000n);
    expect(r.breakdown[1]!.taxOnSliceMinor).toBe(502_320n);
    expect(r.grossTaxMinor).toBe(841_200n + 502_320n);
    expect(r.marginalRatePct).toBe(0.14);
    expect(r.surtaxMinor).toBe(0n);
  });

  it("married ₪25k/mo (₪300k/yr) with 2 children + olim multiplier", () => {
    // Income ₪300,000/yr -> 30_000_000n.
    // Brackets:
    //   B1 ₪84,120 @ 10%   -> 8,412
    //   B2 ₪36,600 @ 14%   -> 5,124
    //   B3 ₪107,280 @ 20%  -> 21,456
    //   B4 ₪72,000 @ 31%   -> 22,320   (₪228,000..₪300,000)
    // Gross = 57,312.  Marginal = 31%.
    const r = computeIncomeTax({
      grossAnnualMinor: 30_000_000n,
      creditPoints: 0,
      rules: IL_2026,
    });
    expect(r.marginalRatePct).toBe(0.31);
    expect(r.breakdown).toHaveLength(4);
    const sum = r.breakdown.reduce(
      (acc, b) => acc + b.taxOnSliceMinor,
      0n,
    );
    expect(r.grossTaxMinor).toBe(sum);
    // Credit points: 2.25 baseline + 2.5 (one child <6) + 1 (one child 6-17)
    // = 5.75 points × ₪2,904 = ₪16,698.
    const cp = 5.75;
    const r2 = computeIncomeTax({
      grossAnnualMinor: 30_000_000n,
      creditPoints: cp,
      rules: IL_2026,
    });
    expect(r2.creditValueMinor).toBe(BigInt(Math.round(cp * 2_904 * 100)));
    expect(r2.netTaxMinor).toBe(r.grossTaxMinor - r2.creditValueMinor);
  });

  it("top-bracket case (₪1,000,000/yr) — surtax adds to net tax", () => {
    // Income ₪1,000,000/yr -> 100_000_000n.
    // Walks every bracket; final slice (₪721,560 → ₪1,000,000 = ₪278,440)
    // taxed at 47%. Surtax 3% on the same slice → ₪8,353.20.
    const r = computeIncomeTax({
      grossAnnualMinor: 100_000_000n,
      creditPoints: 0,
      rules: IL_2026,
    });
    expect(r.surtaxMinor).toBeGreaterThan(0n);
    // Effective top marginal lifts to 50% with surtax.
    expect(r.marginalRatePct).toBeCloseTo(0.50, 6);

    // Manual check: surtax base = ₪1,000,000 - ₪721,560 = ₪278,440.
    // 3% of ₪278,440 = ₪8,353.20 → 835_320n.
    expect(r.surtaxMinor).toBe(835_320n);
  });

  it("credit points cannot create a refund (floor at 0)", () => {
    const r = computeIncomeTax({
      grossAnnualMinor: 50_000_00n, // ₪5,000/yr — well inside 10% bracket
      creditPoints: 100, // wildly more credit than tax
      rules: IL_2026,
    });
    expect(r.netTaxMinor).toBe(0n);
    expect(r.grossTaxMinor).toBeLessThan(r.creditValueMinor);
  });

  it("rejects negative income and non-finite credit points", () => {
    expect(() =>
      computeIncomeTax({
        grossAnnualMinor: -1n,
        creditPoints: 0,
        rules: IL_2026,
      }),
    ).toThrow();
    expect(() =>
      computeIncomeTax({
        grossAnnualMinor: 100n,
        creditPoints: Number.NaN,
        rules: IL_2026,
      }),
    ).toThrow();
  });
});

describe("marginalBracketIndex", () => {
  it("returns -1 for non-positive income", () => {
    expect(marginalBracketIndex(0n, IL_2026)).toBe(-1);
    expect(marginalBracketIndex(-1n, IL_2026)).toBe(-1);
  });
  it("snaps to bracket 0 below ₪84,120", () => {
    expect(marginalBracketIndex(50_00n, IL_2026)).toBe(0);
  });
  it("snaps to bracket 2 (20%) at ₪200,000/yr", () => {
    expect(marginalBracketIndex(20_000_000n, IL_2026)).toBe(2);
  });
  it("returns the open-ended top bracket at ₪10M", () => {
    const idx = marginalBracketIndex(1_000_000_000n, IL_2026);
    expect(idx).toBe(IL_2026.incomeTaxBrackets.length - 1);
  });
});
