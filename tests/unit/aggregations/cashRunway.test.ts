import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/aggregations/cashOnHand", () => ({
  getCashOnHand: vi.fn(),
}));

vi.mock("@/lib/db/withUser", () => ({
  withUser: async <T,>(
    _userId: string,
    fn: (tx: { execute: (q: unknown) => Promise<unknown[]> }) => Promise<T>,
  ): Promise<T> =>
    fn({
      execute: async () => burnRows,
    }),
}));

import { getCashOnHand } from "@/lib/aggregations/cashOnHand";
const { getCashRunway } = await import("@/lib/aggregations/cashRunway");

let burnRows: Array<{ month_bucket: string; direction: string; total_minor: string }> = [];

describe("getCashRunway", () => {
  beforeEach(() => {
    burnRows = [];
    vi.clearAllMocks();
  });

  it("returns months = cash / monthly burn when burn > 0", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 36_000,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-03", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-02", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-04", direction: "income", total_minor: "0" },
    ];

    const result = await getCashRunway("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });

    expect(result.monthsRemaining).toBeCloseTo(3, 1);
    expect(result.cashOnHandMajor).toBe(36_000);
    expect(result.avgMonthlyNetBurnMajor).toBeGreaterThan(0);
  });

  it("returns null months when burn is zero or negative", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 10_000,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "100000" },
      { month_bucket: "2026-04", direction: "income", total_minor: "200000" },
    ];
    const result = await getCashRunway("user-1");
    expect(result.monthsRemaining).toBeNull();
  });

  it("returns zero months when cash on hand is non-positive", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 0,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "100000" },
    ];
    const result = await getCashRunway("user-1");
    expect(result.monthsRemaining).toBe(0);
  });
});
