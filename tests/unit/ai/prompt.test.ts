import { describe, it, expect } from "vitest";
import {
  DEFAULT_DISCLAIMER,
  DISCLAIMER_SUFFIX_EN,
  DISCLAIMER_SUFFIX_HE,
  IL_TAX_ADVISOR_SYSTEM_PROMPT,
  disclaimerSuffixForLocale,
  ensureDisclaimer,
} from "@/lib/ai/prompt";

describe("disclaimer constants", () => {
  it("Hebrew and English disclaimers are non-empty", () => {
    expect(DEFAULT_DISCLAIMER.he.length).toBeGreaterThan(10);
    expect(DEFAULT_DISCLAIMER.en.length).toBeGreaterThan(10);
  });

  it("suffix strings contain the canonical disclaimer text", () => {
    expect(DISCLAIMER_SUFFIX_HE).toContain(DEFAULT_DISCLAIMER.he);
    expect(DISCLAIMER_SUFFIX_EN).toContain(DEFAULT_DISCLAIMER.en);
  });

  it("Hebrew suffix contains Hebrew text", () => {
    expect(/[֐-׿]/.test(DISCLAIMER_SUFFIX_HE)).toBe(true);
  });
});

describe("IL_TAX_ADVISOR_SYSTEM_PROMPT", () => {
  it("contains both disclaimer strings — every response must end with one", () => {
    expect(IL_TAX_ADVISOR_SYSTEM_PROMPT).toContain(DEFAULT_DISCLAIMER.he);
    expect(IL_TAX_ADVISOR_SYSTEM_PROMPT).toContain(DEFAULT_DISCLAIMER.en);
  });

  it("explicitly forbids filing / submitting / signing", () => {
    expect(IL_TAX_ADVISOR_SYSTEM_PROMPT).toMatch(/Do not file/i);
  });

  it("calls out the 2026-06-01 חשבונית-ישראל threshold drop", () => {
    expect(IL_TAX_ADVISOR_SYSTEM_PROMPT).toContain("2026-06-01");
  });

  it("instructs about VAT 18%", () => {
    expect(IL_TAX_ADVISOR_SYSTEM_PROMPT).toContain("18%");
  });
});

describe("disclaimerSuffixForLocale", () => {
  it("returns the Hebrew suffix for he-IL", () => {
    expect(disclaimerSuffixForLocale("he-IL")).toBe(DISCLAIMER_SUFFIX_HE);
  });
  it("returns the English suffix for en-US", () => {
    expect(disclaimerSuffixForLocale("en-US")).toBe(DISCLAIMER_SUFFIX_EN);
  });
  it("falls back to English for ru-RU (marketing-only Russian, Plan v4 risk #24)", () => {
    expect(disclaimerSuffixForLocale("ru-RU")).toBe(DISCLAIMER_SUFFIX_EN);
  });
});

describe("ensureDisclaimer", () => {
  it("appends the Hebrew disclaimer when missing", () => {
    const out = ensureDisclaimer("התשובה: ₪123", "he-IL");
    expect(out).toContain(DEFAULT_DISCLAIMER.he);
  });

  it("does not double-append when the response already includes it", () => {
    const original = `הנה התשובה.\n— ${DEFAULT_DISCLAIMER.he}`;
    const out = ensureDisclaimer(original, "he-IL");
    const matches = out.match(new RegExp(DEFAULT_DISCLAIMER.he, "g")) ?? [];
    expect(matches.length).toBe(1);
  });

  it("appends the English disclaimer for en-US", () => {
    const out = ensureDisclaimer("Answer: 18% VAT", "en-US");
    expect(out).toContain(DEFAULT_DISCLAIMER.en);
  });

  it("treats existing Hebrew disclaimer as sufficient when emitting English", () => {
    // Belt-and-braces: if the model already attached the HE disclaimer
    // for some reason while we're in en-US, we don't tack on the EN one
    // — the spec is "exactly one disclaimer ends the message".
    const out = ensureDisclaimer(`Body.\n— ${DEFAULT_DISCLAIMER.he}`, "en-US");
    expect(out.includes(DEFAULT_DISCLAIMER.he)).toBe(true);
    expect(out.includes(DEFAULT_DISCLAIMER.en)).toBe(false);
  });
});
