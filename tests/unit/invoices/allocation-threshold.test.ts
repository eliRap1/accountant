import { describe, it, expect } from "vitest";
import {
  activeThresholdAt,
  requiresAllocationNumber,
  INVOICE_ALLOCATION_THRESHOLDS_MINOR,
} from "@/lib/invoices/allocationThreshold";

describe("activeThresholdAt", () => {
  it("returns ₪20,000 (in agorot) on 2025-06-15", () => {
    expect(activeThresholdAt(new Date(Date.UTC(2025, 5, 15)))).toBe(2_000_000n);
  });

  it("returns ₪10,000 on 2026-01-01 (exact boundary)", () => {
    expect(activeThresholdAt(new Date(Date.UTC(2026, 0, 1)))).toBe(1_000_000n);
  });

  it("returns ₪20,000 the moment before 2026-01-01", () => {
    expect(
      activeThresholdAt(new Date(Date.UTC(2025, 11, 31, 23, 59, 59))),
    ).toBe(2_000_000n);
  });

  it("returns ₪5,000 on 2026-06-01 (Plan v4 acceleration)", () => {
    expect(activeThresholdAt(new Date(Date.UTC(2026, 5, 1)))).toBe(500_000n);
  });

  it("returns ₪10,000 the moment before 2026-06-01", () => {
    expect(
      activeThresholdAt(new Date(Date.UTC(2026, 4, 31, 23, 59, 59))),
    ).toBe(1_000_000n);
  });

  it("returns ₪25,000 for 2024 dates (initial allocation phase)", () => {
    expect(activeThresholdAt(new Date(Date.UTC(2024, 5, 1)))).toBe(2_500_000n);
  });

  it("returns a large sentinel for pre-2024 dates (no rule yet)", () => {
    expect(activeThresholdAt(new Date(Date.UTC(2023, 11, 31)))).toBe(
      9_223_372_036_854_775_807n,
    );
  });
});

describe("requiresAllocationNumber — osek_patur exemption", () => {
  it("returns false for osek_patur regardless of amount", () => {
    // 1 trillion agorot — astronomical.
    expect(
      requiresAllocationNumber(
        new Date(Date.UTC(2026, 11, 1)),
        1_000_000_000_000n,
        "osek_patur",
      ),
    ).toBe(false);
  });

  it("returns false for osek_patur at the threshold boundary", () => {
    expect(
      requiresAllocationNumber(
        new Date(Date.UTC(2026, 5, 1)),
        500_000n + 1n,
        "osek_patur",
      ),
    ).toBe(false);
  });
});

describe("requiresAllocationNumber — boundary cases at 2026-01-01", () => {
  const justBefore = new Date(Date.UTC(2025, 11, 31, 23, 59, 59)); // ₪20k threshold
  const onOrAfter = new Date(Date.UTC(2026, 0, 1)); // ₪10k threshold

  it("₪9,999 the day before 2026-01-01 — not required", () => {
    expect(
      requiresAllocationNumber(justBefore, 999_900n, "osek_morshe"),
    ).toBe(false);
  });

  it("₪10,000 the day before 2026-01-01 — still under ₪20k threshold", () => {
    expect(
      requiresAllocationNumber(justBefore, 1_000_000n, "osek_morshe"),
    ).toBe(false);
  });

  it("₪10,001 on 2026-01-01 — over new ₪10k threshold, required", () => {
    expect(
      requiresAllocationNumber(onOrAfter, 1_000_100n, "osek_morshe"),
    ).toBe(true);
  });

  it("₪10,000 exactly on 2026-01-01 — at threshold, NOT required (strict gt)", () => {
    expect(
      requiresAllocationNumber(onOrAfter, 1_000_000n, "osek_morshe"),
    ).toBe(false);
  });

  it("₪9,999 on 2026-01-01 — under threshold, not required", () => {
    expect(
      requiresAllocationNumber(onOrAfter, 999_900n, "osek_morshe"),
    ).toBe(false);
  });
});

describe("requiresAllocationNumber — boundary cases at 2026-06-01", () => {
  const justBefore = new Date(Date.UTC(2026, 4, 31, 23, 59, 59)); // ₪10k
  const onOrAfter = new Date(Date.UTC(2026, 5, 1)); // ₪5k

  it("₪5,000 the day before — under ₪10k threshold, not required", () => {
    expect(
      requiresAllocationNumber(justBefore, 500_000n, "osek_morshe"),
    ).toBe(false);
  });

  it("₪5,001 on 2026-06-01 — over new ₪5k threshold, required", () => {
    expect(
      requiresAllocationNumber(onOrAfter, 500_100n, "osek_morshe"),
    ).toBe(true);
  });

  it("₪5,000 exactly on 2026-06-01 — at threshold, not required (strict gt)", () => {
    expect(
      requiresAllocationNumber(onOrAfter, 500_000n, "osek_morshe"),
    ).toBe(false);
  });
});

describe("INVOICE_ALLOCATION_THRESHOLDS_MINOR table shape", () => {
  it("has rules sorted ascending by effective date", () => {
    for (let i = 1; i < INVOICE_ALLOCATION_THRESHOLDS_MINOR.length; i++) {
      const prev = INVOICE_ALLOCATION_THRESHOLDS_MINOR[i - 1]!;
      const cur = INVOICE_ALLOCATION_THRESHOLDS_MINOR[i]!;
      expect(cur.effectiveFrom.getTime()).toBeGreaterThan(
        prev.effectiveFrom.getTime(),
      );
    }
  });

  it("monotonically decreases in amount across steps", () => {
    for (let i = 1; i < INVOICE_ALLOCATION_THRESHOLDS_MINOR.length; i++) {
      const prev = INVOICE_ALLOCATION_THRESHOLDS_MINOR[i - 1]!;
      const cur = INVOICE_ALLOCATION_THRESHOLDS_MINOR[i]!;
      expect(cur.amountMinor < prev.amountMinor).toBe(true);
    }
  });
});

describe("requiresAllocationNumber — non-patur statuses behave identically", () => {
  it.each(["liable", "osek_morshe", "exporter", "nonprofit"] as const)(
    "%s tracks the dated threshold",
    (status) => {
      expect(
        requiresAllocationNumber(
          new Date(Date.UTC(2026, 5, 1)),
          500_100n,
          status,
        ),
      ).toBe(true);
      expect(
        requiresAllocationNumber(
          new Date(Date.UTC(2026, 5, 1)),
          500_000n,
          status,
        ),
      ).toBe(false);
    },
  );
});
