// IL VAT engine.
//
// Branches on `vat_status` from db/schema/businesses.ts:
//   liable        → standard rate (rules.vatStandardRate, currently 18%)
//   osek_morshe   → same as `liable` for the supplier side
//   osek_patur    → 0% (פטור from charging VAT; cannot deduct input VAT)
//   exporter      → 0% (zero-rated; CAN deduct input VAT)
//   nonprofit     → exempt by default, unless flagged via `taxableActivity`
//
// `explicitZeroRated` lets callers force 0% on a per-line basis (e.g.
// invoice line for an export-of-services within a normally-liable
// business). Phase C invoice editor surfaces this as a per-line toggle.

import type { IlRules, VatComputation, VatStatus } from "./types";

export type ComputeVatArgs = {
  subtotalMinor: bigint;
  vatStatus: VatStatus;
  rules: IlRules;
  /** Per-line override: force 0% even if status is `liable`/`osek_morshe`. */
  explicitZeroRated?: boolean;
  /** Nonprofit can elect taxable status for a specific activity; default false. */
  nonprofitTaxableActivity?: boolean;
};

export function computeVat({
  subtotalMinor,
  vatStatus,
  rules,
  explicitZeroRated = false,
  nonprofitTaxableActivity = false,
}: ComputeVatArgs): VatComputation {
  if (subtotalMinor < 0n) {
    throw new Error("computeVat: subtotalMinor must be non-negative");
  }

  // Explicit zero-rated trumps status (used for cross-border lines).
  if (explicitZeroRated) {
    return {
      effectiveRatePct: 0,
      vatMinor: 0n,
      totalMinor: subtotalMinor,
      reason: "explicit_zero_override",
    };
  }

  if (vatStatus === "osek_patur") {
    return {
      effectiveRatePct: 0,
      vatMinor: 0n,
      totalMinor: subtotalMinor,
      reason: "osek_patur_zero_rated",
    };
  }

  if (vatStatus === "exporter" && rules.vatZeroExportEligible) {
    return {
      effectiveRatePct: 0,
      vatMinor: 0n,
      totalMinor: subtotalMinor,
      reason: "exporter_zero_rated",
    };
  }

  if (vatStatus === "nonprofit") {
    if (!nonprofitTaxableActivity) {
      return {
        effectiveRatePct: 0,
        vatMinor: 0n,
        totalMinor: subtotalMinor,
        reason: "nonprofit_exempt",
      };
    }
    // Nonprofit running a registered taxable activity falls through to
    // the standard-rate branch below.
  }

  const rate = rules.vatStandardRate;
  // Round-half-up to nearest agora — matches PCN874 fixed-width output.
  const SCALE = 10_000n;
  const scaledRate = BigInt(Math.round(rate * Number(SCALE)));
  const vatMinor = (subtotalMinor * scaledRate + SCALE / 2n) / SCALE;

  const reason: VatComputation["reason"] =
    vatStatus === "osek_morshe" ? "osek_morshe_standard" : "liable_standard";

  return {
    effectiveRatePct: rate,
    vatMinor,
    totalMinor: subtotalMinor + vatMinor,
    reason,
  };
}

/**
 * Inverse calculation: given a VAT-inclusive total, recover the
 * subtotal + VAT split for the standard rate. Used for OCR'd receipts
 * where only the brutto figure is visible.
 */
export function splitVatInclusive(totalMinor: bigint, rules: IlRules): {
  subtotalMinor: bigint;
  vatMinor: bigint;
} {
  if (totalMinor < 0n) {
    throw new Error("splitVatInclusive: totalMinor must be non-negative");
  }
  if (rules.vatStandardRate <= 0) {
    return { subtotalMinor: totalMinor, vatMinor: 0n };
  }
  // total = subtotal * (1 + rate). subtotal = total / (1 + rate).
  // Scale to integer math: rateScale = round((1 + rate) * 1e6).
  const SCALE = 1_000_000n;
  const oneScaled = SCALE + BigInt(Math.round(rules.vatStandardRate * Number(SCALE)));
  // Integer division with round-half-up.
  const subtotalMinor = (totalMinor * SCALE + oneScaled / 2n) / oneScaled;
  return {
    subtotalMinor,
    vatMinor: totalMinor - subtotalMinor,
  };
}
