import { describe, it, expect } from "vitest";
import { computeVat, splitVatInclusive } from "@/lib/tax/il/vat";
import { IL_2026 } from "@/lib/tax/il/rules-2026";

describe("computeVat — IL 2026 (18% standard rate)", () => {
  it("osek_patur charges 0%", () => {
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "osek_patur",
      rules: IL_2026,
    });
    expect(r.effectiveRatePct).toBe(0);
    expect(r.vatMinor).toBe(0n);
    expect(r.totalMinor).toBe(1_000_00n);
    expect(r.reason).toBe("osek_patur_zero_rated");
  });

  it("osek_morshe charges 18%", () => {
    // ₪1,000 subtotal × 18% = ₪180.
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "osek_morshe",
      rules: IL_2026,
    });
    expect(r.effectiveRatePct).toBe(0.18);
    expect(r.vatMinor).toBe(180_00n);
    expect(r.totalMinor).toBe(1_180_00n);
    expect(r.reason).toBe("osek_morshe_standard");
  });

  it("exporter zero-rated", () => {
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "exporter",
      rules: IL_2026,
    });
    expect(r.vatMinor).toBe(0n);
    expect(r.reason).toBe("exporter_zero_rated");
  });

  it("nonprofit defaults to exempt", () => {
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "nonprofit",
      rules: IL_2026,
    });
    expect(r.vatMinor).toBe(0n);
    expect(r.reason).toBe("nonprofit_exempt");
  });

  it("nonprofit with taxable activity charges the standard rate", () => {
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "nonprofit",
      rules: IL_2026,
      nonprofitTaxableActivity: true,
    });
    expect(r.vatMinor).toBe(180_00n);
    expect(r.reason).toBe("liable_standard");
  });

  it("explicit zero override beats vat_status", () => {
    const r = computeVat({
      subtotalMinor: 1_000_00n,
      vatStatus: "osek_morshe",
      rules: IL_2026,
      explicitZeroRated: true,
    });
    expect(r.vatMinor).toBe(0n);
    expect(r.reason).toBe("explicit_zero_override");
  });

  it("zero subtotal yields zero VAT regardless of status", () => {
    const r = computeVat({
      subtotalMinor: 0n,
      vatStatus: "liable",
      rules: IL_2026,
    });
    expect(r.vatMinor).toBe(0n);
    expect(r.totalMinor).toBe(0n);
  });

  it("rejects negative subtotal", () => {
    expect(() =>
      computeVat({
        subtotalMinor: -1n,
        vatStatus: "liable",
        rules: IL_2026,
      }),
    ).toThrow();
  });
});

describe("splitVatInclusive", () => {
  it("recovers ₪1000 subtotal + ₪180 VAT from ₪1180 inclusive", () => {
    const r = splitVatInclusive(1_180_00n, IL_2026);
    expect(r.subtotalMinor).toBe(1_000_00n);
    expect(r.vatMinor).toBe(180_00n);
  });

  it("splits 0 cleanly", () => {
    const r = splitVatInclusive(0n, IL_2026);
    expect(r.subtotalMinor).toBe(0n);
    expect(r.vatMinor).toBe(0n);
  });

  it("rejects negative input", () => {
    expect(() => splitVatInclusive(-1n, IL_2026)).toThrow();
  });
});
