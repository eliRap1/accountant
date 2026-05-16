// Type contracts for the IL tax engines (Phase D).
//
// Plan v4 § Tax Positioning: every output of this layer is an ESTIMATE.
// The advisor / dashboard / filing-export surfaces MUST attach
// `DEFAULT_DISCLAIMER` (in lib/ai/prompt.ts) on top of any value we
// surface to a user. Engines themselves stay pure — they don't render
// the disclaimer; runEngineForUser attaches it to the snapshot object.
//
// Money convention: all amounts in this file are minor units (agorot)
// represented as bigint. Percentages are unsigned `number` with a
// fractional point (e.g. 0.18, not 18). Annual / monthly / period
// semantics are encoded in the field name (no surprise units).

import type { vatStatusEnum, entityTypeEnum } from "@/db/schema/businesses";

// ─────────────────────────────────────────────────────────────────────────
// Rule set
// ─────────────────────────────────────────────────────────────────────────

export type IncomeTaxBracket = {
  /** Upper bound of the bracket (annual, minor units). `null` == open-ended top. */
  upToMinor: bigint | null;
  /** Marginal rate applied to the slice INSIDE this bracket. 0.10 = 10%. */
  ratePct: number;
};

export type BituachLeumiClassRates = {
  /** Monthly threshold (minor units). Below this the reduced rate applies. */
  lowBracketUpToMinor: bigint;
  /** Combined NI + health insurance rate on the reduced bracket. */
  lowRatePct: number;
  /** Combined NI + health rate on the high bracket. */
  highRatePct: number;
  /** Monthly ceiling (minor units). Income above this is not liable. */
  monthlyCeilingMinor: bigint;
};

/** Step in the dated invoice-allocation-threshold schedule. */
export type InvoiceAllocationThresholdStep = {
  /** ISO date — first day the step takes effect (inclusive). */
  effectiveFrom: string;
  /** Pre-VAT amount in minor units (₪10,000 == 1_000_000n). */
  amountMinor: bigint;
};

export type AdvanceTaxRateRange = {
  /** Lowest מקדמות rate the ITA typically assigns (e.g. 0.5%). */
  minPct: number;
  /** Highest מקדמות rate seen (sector-dependent). */
  maxPct: number;
};

export type IlRules = {
  /** Tax year these rules apply to. */
  year: number;
  /** Country / regime tag. Always 'IL'. */
  country: "IL";
  /** Ordered (low → high) bracket list. The final bracket has `upToMinor: null`. */
  incomeTaxBrackets: readonly IncomeTaxBracket[];
  /** מס יסף (surtax) threshold and rate, applied ABOVE the regular brackets. */
  surtax: {
    appliesAboveAnnualMinor: bigint;
    additionalRatePct: number;
  };
  /** Annual ILS value of one נקודת זיכוי, minor units (e.g. 2_904_00n). */
  creditPointValueAnnualMinor: bigint;
  bituachLeumiEmployee: BituachLeumiClassRates;
  /** Employer's NI-only contribution (no health insurance). */
  bituachLeumiEmployer: BituachLeumiClassRates;
  bituachLeumiSelfEmployed: BituachLeumiClassRates;
  /** Standard VAT rate (e.g. 0.18). */
  vatStandardRate: number;
  /** Exporters of services / goods get 0% VAT. */
  vatZeroExportEligible: boolean;
  /** Dated rule for חשבונית-ישראל allocation-number threshold. Ordered. */
  invoiceAllocationThresholdsMinor: readonly InvoiceAllocationThresholdStep[];
  /** Range of monthly מקדמות rates the ITA assigns by sector. */
  advanceTaxRateRange: AdvanceTaxRateRange;
};

// ─────────────────────────────────────────────────────────────────────────
// Engine outputs
// ─────────────────────────────────────────────────────────────────────────

export type IncomeTaxBracketBreakdown = {
  rangeFromMinor: bigint;
  rangeToMinor: bigint | null;
  ratePct: number;
  /** Income subjected to this bracket (clamped to (from, to]). */
  slicedIncomeMinor: bigint;
  /** Tax owed within this bracket. */
  taxOnSliceMinor: bigint;
};

export type IncomeTaxResult = {
  grossTaxMinor: bigint;
  creditValueMinor: bigint;
  /** Always non-negative. Credit points cannot create a refund. */
  netTaxMinor: bigint;
  /** Marginal rate of the highest bracket the income reached. */
  marginalRatePct: number;
  /** Effective rate (netTaxMinor / grossAnnualMinor), -1 if income==0. */
  effectiveRatePct: number;
  /** Surtax (מס יסף) component, already included in netTaxMinor. */
  surtaxMinor: bigint;
  breakdown: readonly IncomeTaxBracketBreakdown[];
};

export type VatStatus = (typeof vatStatusEnum.enumValues)[number];
export type EntityType = (typeof entityTypeEnum.enumValues)[number];

export type VatComputation = {
  /** Effective rate used (0 for patur/zero-rated/exempt, vatStandardRate else). */
  effectiveRatePct: number;
  vatMinor: bigint;
  totalMinor: bigint;
  /** Why this result — for UI tooltip + audit. */
  reason:
    | "osek_patur_zero_rated"
    | "osek_morshe_standard"
    | "exporter_zero_rated"
    | "nonprofit_exempt"
    | "explicit_zero_override"
    | "liable_standard";
};

export type EmploymentClass =
  | "employee"
  | "self_employed"
  | "owner_payroll";

export type BituachLeumiResult = {
  employeeContribMinor: bigint;
  employerContribMinor: bigint;
  /** For self-employed `selfContribMinor` is populated and the other two are 0. */
  selfContribMinor: bigint;
  totalContribMinor: bigint;
};

export type CreditPointInputs = {
  /** ✓ for every resident; women get +0.5 baseline (handled in defaultCreditPoints). */
  isResident: boolean;
  /** Female taxpayer flag — affects the gender baseline. */
  isFemale: boolean;
  /** Number of dependent children. Special multipliers apply to <6 years. */
  childrenUnder6: number;
  childrenAged6To17: number;
  childrenAged18: number;
  /** Single parent (חד-הורי / משפחה חד-הורית). */
  isSingleParent: boolean;
  /** Months-since-aliyah for new immigrants. 0..54 inclusive. */
  monthsSinceAliyah: number | null;
  /** Days of reserve duty in the prior calendar year (Amendment 2026). */
  reserveDutyDays: number | null;
  /** Years since IDF discharge (חייל משוחרר). Eligibility 1..3 years. */
  yearsSinceIdfDischarge: number | null;
};

/** Output of `defaultCreditPoints`. */
export type CreditPointBreakdown = {
  /** Total credit points to apply. */
  totalPoints: number;
  /** Per-category breakdown for UI / audit. */
  components: ReadonlyArray<{ label: string; points: number; rationale: string }>;
};

export type AdvanceTaxInstallmentResult = {
  declaredRevenueMinor: bigint;
  ratePct: number;
  installmentMinor: bigint;
};

export type WithholdingTaxResult = {
  grossMinor: bigint;
  certificateRatePct: number;
  withheldMinor: bigint;
  netToCounterpartyMinor: bigint;
};

// ─────────────────────────────────────────────────────────────────────────
// Aggregate snapshot
// ─────────────────────────────────────────────────────────────────────────

export type TaxDisclaimer = {
  he: string;
  en: string;
};

export type TaxEstimate = {
  /** Always present — Phase D blocks any tax UI without it. */
  disclaimer: TaxDisclaimer;
  /** Tax year these numbers are computed under. */
  year: number;
  /** Echo of which rule-set version (rules-<year>.meta.json humanReviewed). */
  rulesVersion: string;
  rulesHumanReviewed: boolean;
  /** Total income (revenue) the user has booked for the period — minor units. */
  incomeMinor: bigint;
  /** Deductible expenses — minor units. */
  expensesMinor: bigint;
  /** Estimated annual income tax (post-credit-points). */
  incomeTax: IncomeTaxResult | null;
  /** Estimated VAT payable in the current 2-month VAT period. */
  vatPayableThisPeriodMinor: bigint;
  /** Bituach Leumi self-employed (the most common Phase D persona). */
  bituachLeumi: BituachLeumiResult | null;
  /** Monthly מקדמות based on declared annual revenue + assigned rate. */
  advanceTaxMonthlyInstallmentMinor: bigint | null;
  /** Active invoice-allocation threshold for *today*, for the UI banner. */
  activeAllocationThresholdMinor: bigint;
  /** Range the user's מקדמות rate is expected to land in. */
  advanceTaxRateRange: AdvanceTaxRateRange;
};
