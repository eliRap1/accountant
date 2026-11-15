import { describe, it, expect, beforeEach } from "vitest";
import {
  categoryCodeTo6111Line,
  line6111ToDescription,
  setUnmappedWarner,
  _resetWarnedUnmapped,
  STANDARD_CHART_TO_6111,
} from "@/lib/filings/maps/cat-to-6111";

describe("categoryCodeTo6111Line — known codes", () => {
  beforeEach(() => {
    _resetWarnedUnmapped();
  });

  it("resolves 1000 (cash on hand) to 1010", () => {
    expect(categoryCodeTo6111Line("1000")).toBe("1010");
  });

  it("resolves 4000 (service revenue) to 4010", () => {
    expect(categoryCodeTo6111Line("4000")).toBe("4010");
  });

  it("resolves 7300 (wages) to 7040", () => {
    expect(categoryCodeTo6111Line("7300")).toBe("7040");
  });

  it("resolves 8000 (bank fees) to 8010", () => {
    expect(categoryCodeTo6111Line("8000")).toBe("8010");
  });

  it("resolves every seeded code without warning", () => {
    const warnings: string[] = [];
    setUnmappedWarner((m) => warnings.push(m));
    try {
      for (const code of STANDARD_CHART_TO_6111.keys()) {
        const line = categoryCodeTo6111Line(code);
        const expected = STANDARD_CHART_TO_6111.get(code);
        expect(line).toBe(expected ?? null);
      }
    } finally {
      setUnmappedWarner((m) => void m);
    }
    // The seed table currently has one explicitly-null mapping (1450).
    // That code SHOULD warn on first lookup.
    expect(warnings.some((w) => w.includes("1450"))).toBe(true);
  });
});

describe("categoryCodeTo6111Line — null and unknown", () => {
  beforeEach(() => {
    _resetWarnedUnmapped();
  });

  it("returns null for an unknown code", () => {
    expect(categoryCodeTo6111Line("9999")).toBeNull();
  });

  it("returns null for the seeded null-line code (1450)", () => {
    expect(categoryCodeTo6111Line("1450")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(categoryCodeTo6111Line("")).toBeNull();
  });

  it("returns null for non-string input via type coercion check", () => {
    // The signature requires `string` but JS lets callers slip non-strings
    // through at the boundary. The function must not crash.
    expect(categoryCodeTo6111Line(undefined as unknown as string)).toBeNull();
  });

  it("warns once on unknown code, then suppresses", () => {
    const warnings: string[] = [];
    setUnmappedWarner((m) => warnings.push(m));
    try {
      categoryCodeTo6111Line("9000");
      categoryCodeTo6111Line("9000");
      categoryCodeTo6111Line("9000");
    } finally {
      setUnmappedWarner((m) => void m);
    }
    expect(warnings.filter((w) => w.includes("9000")).length).toBe(1);
  });
});

describe("line6111ToDescription", () => {
  it("returns bilingual labels for known lines", () => {
    const d = line6111ToDescription("4010");
    expect(d.he.length).toBeGreaterThan(0);
    expect(d.en).toMatch(/Service/i);
  });

  it("falls back to the line code itself for unknown lines", () => {
    const d = line6111ToDescription("9999");
    expect(d.he).toBe("9999");
    expect(d.en).toBe("9999");
  });
});

describe("STANDARD_CHART_TO_6111 — parity sanity", () => {
  it("has entries for the major code families (1xxx-8xxx)", () => {
    const codes = Array.from(STANDARD_CHART_TO_6111.keys());
    const firstDigits = new Set(codes.map((c) => c[0]));
    for (const d of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(firstDigits.has(d)).toBe(true);
    }
  });
});
