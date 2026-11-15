import { describe, it, expect } from "vitest";
import {
  computeBituachLeumi,
  annualBituachLeumi,
} from "@/lib/tax/il/bituachLeumi";
import { IL_2026 } from "@/lib/tax/il/rules-2026";

describe("computeBituachLeumi — employee", () => {
  it("zero salary yields zero", () => {
    const r = computeBituachLeumi({
      monthlyGrossMinor: 0n,
      employmentClass: "employee",
      rules: IL_2026,
    });
    expect(r.employeeContribMinor).toBe(0n);
    expect(r.employerContribMinor).toBe(0n);
    expect(r.totalContribMinor).toBe(0n);
  });

  it("salary at the low-bracket threshold (₪7,703/mo) uses low rate only", () => {
    // Employee: 4.27% of ₪7,703 = ₪328.92.
    // Employer: 4.51% of ₪7,703 = ₪347.41.
    const r = computeBituachLeumi({
      monthlyGrossMinor: 770_300n,
      employmentClass: "employee",
      rules: IL_2026,
    });
    // 4.27% × 770_300n = ~32_891.81 → 32_891n (round-half-up).
    expect(r.employeeContribMinor).toBe(32_892n);
    // 4.51% × 770_300n = ~34_740.53 → 34_741n.
    expect(r.employerContribMinor).toBe(34_741n);
  });

  it("salary above ceiling caps contributions", () => {
    const r = computeBituachLeumi({
      monthlyGrossMinor: 10_000_000n, // ₪100k/mo (way above ceiling)
      employmentClass: "employee",
      rules: IL_2026,
    });
    // Low slice (₪7,703 @ 4.27%) + High slice (₪51,910 - ₪7,703 = ₪44,207 @ 12.17%)
    // High slice: 0.1217 × 4_420_700n = 537_999.19 → 537_999n.
    const expectedLow = 32_892n;
    const expectedHigh = 537_999n;
    expect(r.employeeContribMinor).toBe(expectedLow + expectedHigh);
  });

  it("self-employed populates `selfContribMinor` and zeros the others", () => {
    // ₪10,000/mo self-employed: low slice ₪7,703 @ 6.10% + high ₪2,297 @ 18%.
    const r = computeBituachLeumi({
      monthlyGrossMinor: 1_000_000n,
      employmentClass: "self_employed",
      rules: IL_2026,
    });
    // Low: 770_300n × 6.10% = 46_988.30 → 46_988n.
    // High: (1_000_000n - 770_300n) = 229_700n × 18% = 41_346n.
    expect(r.selfContribMinor).toBe(46_988n + 41_346n);
    expect(r.employeeContribMinor).toBe(0n);
    expect(r.employerContribMinor).toBe(0n);
    expect(r.totalContribMinor).toBe(r.selfContribMinor);
  });

  it("rejects negative monthly gross", () => {
    expect(() =>
      computeBituachLeumi({
        monthlyGrossMinor: -1n,
        employmentClass: "employee",
        rules: IL_2026,
      }),
    ).toThrow();
  });
});

describe("annualBituachLeumi", () => {
  it("scales monthly result by 12", () => {
    const monthly = computeBituachLeumi({
      monthlyGrossMinor: 1_000_000n,
      employmentClass: "self_employed",
      rules: IL_2026,
    });
    const annual = annualBituachLeumi({
      monthlyGrossMinor: 1_000_000n,
      employmentClass: "self_employed",
      rules: IL_2026,
    });
    expect(annual.selfContribMinor).toBe(monthly.selfContribMinor * 12n);
    expect(annual.totalContribMinor).toBe(monthly.totalContribMinor * 12n);
  });
});
