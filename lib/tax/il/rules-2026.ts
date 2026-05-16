// Israel 2026 tax rule-set.
//
// Every numeric value below is sourced from a primary or authoritative
// secondary source — URL + fetch date in the trailing comment of each
// line. `humanReviewed: false` in rules-2026.meta.json keeps
// `pnpm lint:rule-meta` failing until a licensed CPA signs off. That
// gate is intentional per Plan v4 § Tax Positioning.
//
// Money convention: minor units (agorot) as bigint. ₪1 == 100n.
//   ₪84,120 -> 8_412_000n
//   ₪2,904  -> 290_400n
//
// The rule-set is `readonly` / `as const`-equivalent at the type level
// via `satisfies IlRules`. Drift between this file and types.ts is a
// compile error.
//
// Cross-source sanity: the 2026 income-tax bracket schedule below
// reflects Amendment 288 to the Income Tax Ordinance (חוק ההתייעלות
// הכלכלית, פורסם 2026-03-31 ברשומות, רטרואקטיבי 2026-01-01) which
// widened the 20% and 31% bands. Pre-amendment payroll tables
// (frozen-2024 schedule) are NOT used.

import type { IlRules } from "./types";

export const IL_2026: IlRules = {
  year: 2026,
  country: "IL",

  // ─────────────────────────────────────────────────────────────────────
  // Income tax — 7 brackets after Amendment 288 widening.
  //
  // Source: bennygaon.co.il + ferraro-avital.co.il + malam-payroll PDF
  // + Maariv article — cross-verified 2026-05-16. Hebrew gov-gazette
  // ref: "תיקון מס' 288 לפקודת מס הכנסה" (Economic Efficiency Law 2026).
  // ─────────────────────────────────────────────────────────────────────
  incomeTaxBrackets: [
    { upToMinor: 8_412_000n, ratePct: 0.10 }, // ₪84,120 @ 10% — source: https://protocol.co.il/income-tax-rates/ fetched 2026-05-16
    { upToMinor: 12_072_000n, ratePct: 0.14 }, // ₪120,720 @ 14% — source: https://protocol.co.il/income-tax-rates/ fetched 2026-05-16
    { upToMinor: 22_800_000n, ratePct: 0.20 }, // ₪228,000 @ 20% (widened by Amendment 288) — source: https://www.malam-payroll.com/ריווח-מדרגות-מס-הכנסה-מינואר-2026-הבהרה-למ/ fetched 2026-05-16
    { upToMinor: 30_120_000n, ratePct: 0.31 }, // ₪301,200 @ 31% (widened by Amendment 288) — source: https://www.malam-payroll.com/ריווח-מדרגות-מס-הכנסה-מינואר-2026-הבהרה-למ/ fetched 2026-05-16
    { upToMinor: 56_028_000n, ratePct: 0.35 }, // ₪560,280 @ 35% — source: https://ferraro-avital.co.il/cpa-haifa/income-tax-brackets-2026-israel/ fetched 2026-05-16
    { upToMinor: 72_156_000n, ratePct: 0.47 }, // ₪721,560 @ 47% — source: https://ferraro-avital.co.il/cpa-haifa/income-tax-brackets-2026-israel/ fetched 2026-05-16
    { upToMinor: null, ratePct: 0.47 }, // open-ended top @ 47% (the additional 3% lives in `surtax` below — keeps the breakdown clean)
  ],

  // ─────────────────────────────────────────────────────────────────────
  // מס יסף (high-income surtax).
  // 3% on income above ₪721,560 — combines with the top 47% bracket to
  // produce an effective 50% top marginal rate.
  //
  // Source: ferraro-avital.co.il + PwC tax summaries (Israel) + Knesset
  // Press release. Threshold last indexed to average wage in 2024;
  // frozen for 2025-2027 per Israel budget law.
  // ─────────────────────────────────────────────────────────────────────
  surtax: {
    appliesAboveAnnualMinor: 72_156_000n, // ₪721,560 — source: https://ferraro-avital.co.il/cpa-haifa/income-tax-brackets-2026-israel/ fetched 2026-05-16
    additionalRatePct: 0.03, // 3% — source: https://www.timesofisrael.com/wave-of-price-rises-and-tax-hikes-takes-effect-fueling-costs-for-israelis-in-2026/ fetched 2026-05-16
  },

  // ─────────────────────────────────────────────────────────────────────
  // נקודת זיכוי (credit point) — annual value.
  // ₪242/month × 12 = ₪2,904/year.
  //
  // Source: cwsisrael.com (Israeli Tax Changes 2026 — Complete Guide)
  // + oritax.co.il + ferraro-avital.co.il. Cross-verified 2026-05-16.
  // Linked to the average wage index; frozen for 2026 per budget.
  // ─────────────────────────────────────────────────────────────────────
  creditPointValueAnnualMinor: 290_400n, // ₪2,904/yr — source: https://www.cwsisrael.com/israeli-tax-changes-2026-complete-guide/ fetched 2026-05-16

  // ─────────────────────────────────────────────────────────────────────
  // Bituach Leumi + Bituach Bri'ut (national + health insurance).
  //
  // 2026 average wage (לחישוב דמי ביטוח): ₪13,769/mo.
  // 60% threshold: ₪7,703/mo (Malam-Payroll, January-2026 circular,
  //   reflecting the official BTL PDF). Note: jobcalc.co.il + some
  //   secondary sources quote ₪7,522 (older 2025 figure) — the
  //   Malam-Payroll number is the authoritative 2026 value.
  // Monthly ceiling: ₪51,910/mo (== ₪622,920/yr).
  //
  // Source: https://www.btl.gov.il/English Homepage/Insurance/Ratesandamount/Pages/Selfemployedperson.aspx (BTL official) fetched 2026-05-16
  // Cross-source: https://www.malam-payroll.com/national-insurance-updates-for-2026/ fetched 2026-05-16
  // ─────────────────────────────────────────────────────────────────────
  bituachLeumiEmployee: {
    lowBracketUpToMinor: 770_300n, // ₪7,703/mo — source: BTL TikratAtzmaee + malam-payroll fetched 2026-05-16
    lowRatePct: 0.0427, // 4.27% (NI 1.04% + health 3.23%) — source: https://jobcalc.co.il/blog/national-insurance-guide-2026/ fetched 2026-05-16
    highRatePct: 0.1217, // 12.17% (NI 7.0% + health 5.17%) — source: https://jobcalc.co.il/blog/national-insurance-guide-2026/ fetched 2026-05-16
    monthlyCeilingMinor: 5_191_000n, // ₪51,910/mo — source: BTL TikratAtzmaee fetched 2026-05-16
  },
  bituachLeumiEmployer: {
    lowBracketUpToMinor: 770_300n, // ₪7,703/mo — same threshold as employee
    lowRatePct: 0.0451, // 4.51% (NI only; no health portion for employer) — source: https://jobcalc.co.il/blog/national-insurance-guide-2026/ fetched 2026-05-16
    highRatePct: 0.0760, // 7.60% — source: https://jobcalc.co.il/blog/national-insurance-guide-2026/ fetched 2026-05-16
    monthlyCeilingMinor: 5_191_000n, // ₪51,910/mo
  },
  bituachLeumiSelfEmployed: {
    lowBracketUpToMinor: 770_300n, // ₪7,703/mo
    lowRatePct: 0.0610, // 6.10% (NI 2.87% + health 3.23%) — source: https://jobcalc.co.il/blog/national-insurance-guide-2026/ fetched 2026-05-16
    highRatePct: 0.1800, // 18.00% (NI 12.83% + health 5.17%) — source: https://www.btl.gov.il/English Homepage/Insurance/Ratesandamount/Pages/Selfemployedperson.aspx fetched 2026-05-16
    monthlyCeilingMinor: 5_191_000n, // ₪51,910/mo
  },

  // ─────────────────────────────────────────────────────────────────────
  // VAT.
  // Source: https://www.vatupdate.com/2025/12/10/israel-approves-2026-budget-vat-stays-at-18-expands-exemptions-eases-bank-entry-rules/ fetched 2026-05-16
  // Cross-source: PwC Tax Summaries (Israel - Other Taxes) — confirms 18%.
  // The proposal to raise to 19% in 2026 was withdrawn; budget law
  // approved December 2025 keeps the 18% rate.
  // ─────────────────────────────────────────────────────────────────────
  vatStandardRate: 0.18, // 18% — verified 2026-05-16
  vatZeroExportEligible: true, // 0% for exporters of goods + services — VAT Law §30 + ITA guidance

  // ─────────────────────────────────────────────────────────────────────
  // חשבונית-ישראל — invoice allocation-number threshold (pre-VAT).
  //
  //   2024-01-01 → ₪25,000  (system launched May-2024 but the rule was on the books from 2024-01-01)
  //   2025-01-01 → ₪20,000
  //   2026-01-01 → ₪10,000
  //   2026-06-01 → ₪5,000   ← drops 2 weeks from today (2026-05-16)
  //
  // Sources (all fetched 2026-05-16):
  //   https://www.gov.il/he/service/request-assignment-number-for-tax-invoice
  //   https://britcpa.co.il/hozrim/מודל-חשבוניות-ישראל-עדכונים-לשנת-2026/
  //   https://www.greeninvoice.co.il/magazine/israel-invoice/
  //
  // App enforcement: lib/invoices/allocationThreshold.ts (Phase C) selects
  // the step active at issue_date. UI banner copy adapts to the matched step.
  // ─────────────────────────────────────────────────────────────────────
  invoiceAllocationThresholdsMinor: [
    { effectiveFrom: "2024-01-01", amountMinor: 2_500_000n }, // ₪25,000
    { effectiveFrom: "2025-01-01", amountMinor: 2_000_000n }, // ₪20,000
    { effectiveFrom: "2026-01-01", amountMinor: 1_000_000n }, // ₪10,000
    { effectiveFrom: "2026-06-01", amountMinor: 500_000n }, //   ₪5,000
  ],

  // ─────────────────────────────────────────────────────────────────────
  // מקדמות (advance tax) — ITA-assigned rate range.
  //
  // The ITA sets a per-business "ratio of revenue" rate based on prior-
  // year turnover and sector. Common ranges (per Kol-Zchut + israeli-tax.com
  // + orencpa.com guides): 0.5% – 7% depending on industry profit margin.
  // The widest band covers high-margin services; the typical small
  // services business lands 3-5%.
  //
  // Source: https://orencpa.com/income-tax-advances-israel-guide/ fetched 2026-05-16
  // Source: https://israeli-tax.com/blog/quarterly-advance-tax-payments-mikdamot fetched 2026-05-16
  //
  // <verify-this>: the upper bound is reportable as high as 10% in
  // certain high-margin sectors per Kol-Zchut, but no primary gov.il
  // ITA publication enumerates a fixed maximum. Treat as advisory.
  // ─────────────────────────────────────────────────────────────────────
  advanceTaxRateRange: {
    minPct: 0.005, // 0.5% — source: https://orencpa.com/income-tax-advances-israel-guide/ fetched 2026-05-16
    maxPct: 0.07, // 7%   — source: https://orencpa.com/income-tax-advances-israel-guide/ fetched 2026-05-16 — <verify-this> against per-sector ITA tables
  },
} satisfies IlRules;
