import { describe, it, expect } from "vitest";
import {
  IL_ID_DIGITS,
  normalizeIlId,
  validateTeudatZehut,
  validateVatId,
} from "@/lib/invoices/ilValidate";

// Synthetic IDs whose checksum digit was brute-forced to satisfy the
// Luhn-variant algorithm published by the ITA. NONE of these correspond
// to real human IDs or real businesses.
const VALID_TZ_SAMPLES = [
  "123456782",
  "514321983",
  "300000007",
  "999999998",
  "200000008",
  "000000018",
];

// Same algorithm — these double as ח.פ. / ע.מ. samples in the VAT id tests.
const INVALID_SAMPLES = [
  "123456789", // checksum off by one
  "514321987", // checksum off
  "111111111", // checksum invalid for trivially-repeating digits
  "000000001", // checksum invalid
  "abcdefghi", // not digits
  "12345", // too short
  "1234567890", // too long
];

describe("IL_ID_DIGITS", () => {
  it("is 9", () => {
    expect(IL_ID_DIGITS).toBe(9);
  });
});

describe("normalizeIlId", () => {
  it("strips dashes and whitespace", () => {
    expect(normalizeIlId("123-456-782")).toBe("123456782");
    expect(normalizeIlId("  514 321 983  ")).toBe("514321983");
  });

  it("left-pads short inputs to 9 digits", () => {
    expect(normalizeIlId("18")).toBe("000000018");
    expect(normalizeIlId("123")).toBe("000000123");
  });

  it("returns the raw too-long digit string so checksum can fail loudly", () => {
    expect(normalizeIlId("1234567890")).toBe("1234567890");
  });

  it("ignores non-string input", () => {
    // @ts-expect-error — runtime guard for callers that forget to stringify.
    expect(normalizeIlId(undefined)).toBe("");
  });
});

describe("validateTeudatZehut", () => {
  it.each(VALID_TZ_SAMPLES)("accepts valid synthetic ת.ז. %s", (id) => {
    expect(validateTeudatZehut(id)).toBe(true);
  });

  it("accepts valid ID with dashes/whitespace separators", () => {
    expect(validateTeudatZehut("123-456-782")).toBe(true);
    expect(validateTeudatZehut(" 514 321 983 ")).toBe(true);
  });

  it("rejects all-zero ID even though its checksum is mathematically valid", () => {
    expect(validateTeudatZehut("000000000")).toBe(false);
  });

  it.each(INVALID_SAMPLES)("rejects invalid sample %s", (id) => {
    expect(validateTeudatZehut(id)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateTeudatZehut("")).toBe(false);
  });

  it("rejects inputs that contain letters mixed in", () => {
    expect(validateTeudatZehut("1234A6782")).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — defensive boundary check.
    expect(validateTeudatZehut(123456782)).toBe(false);
  });
});

describe("validateVatId", () => {
  it.each(VALID_TZ_SAMPLES)("accepts valid ח.פ./ע.מ. sample %s", (id) => {
    expect(validateVatId(id)).toBe(true);
  });

  it("rejects the same set of invalid samples as the ID validator", () => {
    for (const id of INVALID_SAMPLES) {
      expect(validateVatId(id)).toBe(false);
    }
  });
});
