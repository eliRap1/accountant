import { describe, it, expect } from "vitest";
import { defaultCreditPoints } from "@/lib/tax/il/creditPoints";
import type { CreditPointInputs } from "@/lib/tax/il/types";

function baseInputs(): CreditPointInputs {
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

describe("defaultCreditPoints — baselines", () => {
  it("male resident baseline is 2.25", () => {
    const r = defaultCreditPoints(baseInputs());
    expect(r.totalPoints).toBe(2.25);
  });

  it("female resident baseline is 2.75", () => {
    const r = defaultCreditPoints({ ...baseInputs(), isFemale: true });
    expect(r.totalPoints).toBe(2.75);
  });

  it("non-resident returns 0 with explanatory component", () => {
    const r = defaultCreditPoints({ ...baseInputs(), isResident: false });
    expect(r.totalPoints).toBe(0);
    expect(r.components[0]?.label).toBe("non_resident");
  });
});

describe("defaultCreditPoints — children", () => {
  it("two children under 6 add 5 points", () => {
    const r = defaultCreditPoints({ ...baseInputs(), childrenUnder6: 2 });
    expect(r.totalPoints).toBe(2.25 + 5);
  });

  it("one each across the age bands", () => {
    const r = defaultCreditPoints({
      ...baseInputs(),
      childrenUnder6: 1,
      childrenAged6To17: 1,
      childrenAged18: 1,
    });
    // 2.25 baseline + 2.5 (under 6) + 1 + 1 = 6.75
    expect(r.totalPoints).toBe(6.75);
  });
});

describe("defaultCreditPoints — single parent", () => {
  it("adds exactly 1 point", () => {
    const r = defaultCreditPoints({ ...baseInputs(), isSingleParent: true });
    expect(r.totalPoints).toBe(3.25);
  });
});

describe("defaultCreditPoints — oleh schedule", () => {
  it("returns 0 when not an immigrant", () => {
    const r = defaultCreditPoints(baseInputs());
    expect(r.components.find((c) => c.label === "oleh_chadash")).toBeUndefined();
  });

  it("month 1 → year-1 yields 3 points (12 × 1/4)", () => {
    const r = defaultCreditPoints({ ...baseInputs(), monthsSinceAliyah: 1 });
    const oleh = r.components.find((c) => c.label === "oleh_chadash");
    expect(oleh).toBeDefined();
    // Sum of months 1..12 → all in the 1/18 phase = 12 × 1/4 = 3.
    expect(oleh!.points).toBeCloseTo(3, 9);
    expect(r.totalPoints).toBeCloseTo(2.25 + 3, 9);
  });

  it("month 19 → fully in the 1/6 phase (year 2) = 2 points/year", () => {
    const r = defaultCreditPoints({ ...baseInputs(), monthsSinceAliyah: 19 });
    const oleh = r.components.find((c) => c.label === "oleh_chadash")!;
    expect(oleh.points).toBeCloseTo(2, 9);
  });

  it("month 31 → fully in the 1/12 phase = 1 point/year", () => {
    const r = defaultCreditPoints({ ...baseInputs(), monthsSinceAliyah: 31 });
    const oleh = r.components.find((c) => c.label === "oleh_chadash")!;
    expect(oleh.points).toBeCloseTo(1, 9);
  });

  it("month 50 → past the schedule, 0 points", () => {
    const r = defaultCreditPoints({ ...baseInputs(), monthsSinceAliyah: 50 });
    expect(r.components.find((c) => c.label === "oleh_chadash")).toBeUndefined();
  });
});

describe("defaultCreditPoints — reserve duty + IDF returnee", () => {
  it("9 days reserve = 0 points (below threshold)", () => {
    const r = defaultCreditPoints({ ...baseInputs(), reserveDutyDays: 9 });
    expect(r.components.find((c) => c.label === "reserve_duty")).toBeUndefined();
  });

  it("110 days reserve caps at 4 points", () => {
    const r = defaultCreditPoints({ ...baseInputs(), reserveDutyDays: 110 });
    const rd = r.components.find((c) => c.label === "reserve_duty")!;
    expect(rd.points).toBe(4);
  });

  it("year 1 since IDF discharge adds 2 points", () => {
    const r = defaultCreditPoints({ ...baseInputs(), yearsSinceIdfDischarge: 1 });
    const idf = r.components.find((c) => c.label === "idf_returnee")!;
    expect(idf.points).toBe(2);
  });

  it("year 4 since discharge is past the window — 0 points", () => {
    const r = defaultCreditPoints({ ...baseInputs(), yearsSinceIdfDischarge: 4 });
    expect(r.components.find((c) => c.label === "idf_returnee")).toBeUndefined();
  });
});

describe("defaultCreditPoints — full combination", () => {
  it("female single-parent oleh with 2 young kids stacks correctly", () => {
    const r = defaultCreditPoints({
      ...baseInputs(),
      isFemale: true,
      isSingleParent: true,
      childrenUnder6: 2,
      monthsSinceAliyah: 1,
    });
    // 2.75 + 5 (children) + 1 (single parent) + 3 (oleh year 1) = 11.75.
    expect(r.totalPoints).toBeCloseTo(11.75, 9);
  });
});
