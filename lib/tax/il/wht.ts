// Withholding tax (ניכוי מס במקור) engine.
//
// Two directional helpers:
//   - `computeWhtClientSide` — client withheld tax from US (we received
//     a net payment; the client owes the ITA on our behalf).
//   - `computeWhtSupplierSide` — WE withheld tax from a supplier; we
//     owe the ITA via form 856 + 102.
//
// Both flows take a "certificate rate" (the rate listed on the relevant
// אישור ניכוי מס במקור). Standard rates fall between 0% (full
// exemption certificate) and 47%/50% (no certificate, full top
// bracket).

import type { WithholdingTaxResult } from "./types";

const RATE_SCALE = 1_000_000n;

function applyRate(amountMinor: bigint, ratePct: number): bigint {
  if (amountMinor <= 0n || ratePct === 0) return 0n;
  const scaled = BigInt(Math.round(ratePct * Number(RATE_SCALE)));
  return (amountMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;
}

function validate(grossMinor: bigint, ratePct: number): void {
  if (grossMinor < 0n) {
    throw new Error("wht: grossMinor must be non-negative");
  }
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 1) {
    throw new Error("wht: certificateRatePct must be a fraction in [0,1]");
  }
}

export type ComputeWithholdingTaxArgs = {
  grossMinor: bigint;
  certificateRatePct: number;
};

/**
 * Client withheld from us: input is the gross invoice amount,
 * output is `withheldMinor` (which the client remits to the ITA on
 * our behalf — we book it as a tax-prepaid asset).
 */
export function computeWhtClientSide({
  grossMinor,
  certificateRatePct,
}: ComputeWithholdingTaxArgs): WithholdingTaxResult {
  validate(grossMinor, certificateRatePct);
  const withheldMinor = applyRate(grossMinor, certificateRatePct);
  return {
    grossMinor,
    certificateRatePct,
    withheldMinor,
    netToCounterpartyMinor: grossMinor - withheldMinor,
  };
}

/**
 * We withheld from a supplier: same math, but the directional intent
 * is "we owe the ITA `withheldMinor`, supplier received the net".
 * Phase E form 856 generator consumes the cumulative withheld total.
 */
export function computeWhtSupplierSide(
  args: ComputeWithholdingTaxArgs,
): WithholdingTaxResult {
  return computeWhtClientSide(args);
}

/**
 * Default WHT rate when no certificate is on file. Per IL Income Tax
 * Ordinance §164 + extension regulations: services rendered without a
 * certificate trigger 30%–47% withholding (varies by sector). Used as a
 * conservative fallback in the UI when the user has no aישור on file.
 */
export const DEFAULT_NO_CERT_RATE_PCT = 0.30; // 30% — conservative floor; source: ITA §164 guidance — verify per sector
