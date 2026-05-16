import { describe, it, expect } from "vitest";
import {
  padLeft,
  padRight,
  truncate,
  assertExactWidth,
  formatAmountMinor,
  formatDateYYYYMMDD,
} from "@/lib/filings/fixedWidth";

describe("padLeft", () => {
  it("pads with zeroes by default", () => {
    expect(padLeft(5, 4)).toBe("0005");
  });

  it("pads strings with explicit char", () => {
    expect(padLeft("AB", 5, " ")).toBe("   AB");
  });

  it("returns identical value at exact width", () => {
    expect(padLeft("12345", 5)).toBe("12345");
  });

  it("throws when value wider than width", () => {
    expect(() => padLeft("123456", 5)).toThrow(/wider/);
  });

  it("throws when pad char is multi-char", () => {
    expect(() => padLeft("1", 4, "ab")).toThrow(/1 character/);
  });

  it("throws on negative width", () => {
    expect(() => padLeft("x", -1)).toThrow(/non-negative/);
  });

  it("supports bigint", () => {
    expect(padLeft(1234567890n, 12)).toBe("001234567890");
  });
});

describe("padRight", () => {
  it("pads with spaces by default", () => {
    expect(padRight("AB", 5)).toBe("AB   ");
  });

  it("returns identical value at exact width", () => {
    expect(padRight("12345", 5)).toBe("12345");
  });

  it("throws when value wider than width", () => {
    expect(() => padRight("123456", 5)).toThrow(/wider/);
  });
});

describe("truncate", () => {
  it("returns unchanged value if already within width", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("slices to width", () => {
    expect(truncate("abcdef", 4)).toBe("abcd");
  });

  it("returns empty for width 0", () => {
    expect(truncate("abc", 0)).toBe("");
  });

  it("throws on negative width", () => {
    expect(() => truncate("x", -1)).toThrow(/non-negative/);
  });
});

describe("assertExactWidth", () => {
  it("passes on exact width", () => {
    expect(() => assertExactWidth("abcde", 5, "test")).not.toThrow();
  });

  it("throws with label on mismatch", () => {
    expect(() => assertExactWidth("abc", 5, "myField")).toThrow(/myField/);
  });
});

describe("formatAmountMinor", () => {
  it("zero-pads to width", () => {
    expect(formatAmountMinor(123n, 8)).toBe("00000123");
  });

  it("supports zero", () => {
    expect(formatAmountMinor(0n, 4)).toBe("0000");
  });

  it("throws on negative", () => {
    expect(() => formatAmountMinor(-1n, 4)).toThrow(/non-negative/);
  });

  it("throws when exceeds width", () => {
    expect(() => formatAmountMinor(1234567890n, 4)).toThrow(/wider/);
  });
});

describe("formatDateYYYYMMDD", () => {
  it("formats Jan 1 correctly", () => {
    expect(formatDateYYYYMMDD(new Date(Date.UTC(2026, 0, 1)))).toBe("20260101");
  });

  it("formats Dec 31 correctly", () => {
    expect(formatDateYYYYMMDD(new Date(Date.UTC(2026, 11, 31)))).toBe("20261231");
  });

  it("pads single-digit month and day", () => {
    expect(formatDateYYYYMMDD(new Date(Date.UTC(2026, 4, 9)))).toBe("20260509");
  });

  it("throws on invalid date", () => {
    expect(() => formatDateYYYYMMDD(new Date("not-a-date"))).toThrow(/invalid/);
  });
});
