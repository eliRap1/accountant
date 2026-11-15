// Bi-monthly VAT window helper.
//
// IL VAT periodicity (verified 2026-05-16 via cwsisrael.com + globalvatcompliance.com):
//
//   • Most עוסקים file BI-MONTHLY: Jan-Feb, Mar-Apr, May-Jun, Jul-Aug, Sep-Oct, Nov-Dec.
//   • A few high-turnover businesses are MONTHLY.
//   • עוסק פטור files an ANNUAL zero return — for Morning Brief purposes we still
//     surface a "next-window" forecast but the amount is always 0n (no VAT collected).
//
// Filing + payment deadline: the 15th day of the month FOLLOWING the period end.
//   Period Jan-Feb (period end 2026-02-28)  → due 2026-03-15
//   Period Mar-Apr (period end 2026-04-30)  → due 2026-05-15
//   Period May-Jun (period end 2026-06-30)  → due 2026-07-15
//   Period Jul-Aug                          → due 2026-09-15
//   Period Sep-Oct                          → due 2026-11-15
//   Period Nov-Dec                          → due 2026-01-15 (next year)
//
// Source: cwsisrael.com Freelancer Tax Compliance 2026 — "periodic returns must be
//   filed before the 15th day of the month following the end of the reporting
//   period". Online portal extends to 19th 18:30, but we surface the legal 15th.
//
// The window we return covers the PERIOD JUST CLOSED relative to `now` — i.e. the
// period whose deadline is still ahead OR ≤ ~30 days behind. That way Morning Brief
// keeps surfacing the deadline through-and-beyond it (no abrupt zero-VAT once the
// new period starts on the 1st but the previous deadline hasn't yet hit on the 15th).
//
// Edge: if `now` is the 16th-31st of (Mar/May/Jul/Sept/Nov/Jan), the previous
// period's deadline has already passed; we then return the CURRENT in-progress
// period whose deadline is upcoming.

import type { VatStatus } from "@/lib/tax/il/types";

export type VatWindow = {
  /** Inclusive start date of the bi-monthly period (UTC midnight). */
  periodStart: Date;
  /** EXCLUSIVE end date of the period — the 1st of the month after the period ends. */
  periodEnd: Date;
  /** Filing + payment deadline — 15th of the month following `periodEnd`'s month-before. */
  dueDate: Date;
  /** Human-friendly month-pair label (en): "Mar-Apr". */
  labelEn: string;
  /** Human-friendly month-pair label (he): "מרץ-אפריל". */
  labelHe: string;
  /** Whether this window's deadline is in the future relative to `now`. */
  deadlineUpcoming: boolean;
};

// Hebrew month names. Index 0 = January.
const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

// English short month names. Index 0 = January.
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Compute the upcoming bi-monthly VAT filing window relative to `now`.
 *
 * Algorithm:
 *   1. Identify which bi-monthly period `now` falls into.
 *   2. The DUE date of THAT period is the 15th of the month AFTER the period's last month.
 *      e.g. May (month 4) → period May-Jun → due Jul-15.
 *   3. If the due date is in the future OR we're inside the period itself → return that window.
 *   4. If we're past the period AND past its deadline (rare: only between 16th-of-the-month
 *      AFTER period close and the start of the NEXT period — but in IL that gap doesn't
 *      exist; period closes month-end, next period starts next day) → return the next window.
 *
 * vatStatus matters only for the AMOUNT (caller computes it via runFullTaxEngine);
 * the window dates are identical across statuses except for osek_patur which is
 * annual — caller should detect that and use the annual deadline instead (handled
 * with `isAnnualFiler` below for completeness).
 */
export function getCurrentVatWindow(
  now: Date = new Date(),
  vatStatus: VatStatus = "osek_morshe",
): VatWindow {
  // osek_patur files annually (zero return). We still surface the next
  // bi-monthly anchor for visual consistency in the brief; the caller
  // can choose to skip VAT mention entirely when amount=0n.
  void vatStatus; // reserved for future special-casing

  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth(); // 0-11
  const dayOfMonth = now.getUTCDate();

  // Bi-monthly period start month: 0 (Jan), 2 (Mar), 4 (May), 6 (Jul), 8 (Sep), 10 (Nov).
  let periodStartMonth = Math.floor(monthIdx / 2) * 2;
  let periodYear = year;

  // The deadline of the period ending in month (periodStartMonth + 1) is the
  // 15th of month (periodStartMonth + 2). If today is past that 15th, the
  // period CURRENT to today is the next pair, not this one.
  //
  // Translation: if today is between the 1st of the 2nd month of the period
  // and the 15th of the month AFTER, we're "in the just-closed/closing window
  // whose deadline is still upcoming". Otherwise we're in a fresh period whose
  // deadline is far away.
  //
  // Simpler: always show the period whose DEADLINE is the next one to hit
  // (closest future 15th-of-odd-month, after Jan/Mar/May/Jul/Sep/Nov).
  //
  // Deadlines: Mar-15 (Jan-Feb), May-15 (Mar-Apr), Jul-15 (May-Jun),
  // Sep-15 (Jul-Aug), Nov-15 (Sep-Oct), Jan-15-next-year (Nov-Dec).

  // Find the next due date ≥ today.
  //
  // Candidate due dates this year + first one of next year:
  const candidates: Array<{ periodStart: [number, number]; due: [number, number, number] }> = [
    // [year, month0idx] for period start; [year, month0idx, day] for due
    { periodStart: [year, 0], due: [year, 2, 15] },     // Jan-Feb → Mar-15
    { periodStart: [year, 2], due: [year, 4, 15] },     // Mar-Apr → May-15
    { periodStart: [year, 4], due: [year, 6, 15] },     // May-Jun → Jul-15
    { periodStart: [year, 6], due: [year, 8, 15] },     // Jul-Aug → Sep-15
    { periodStart: [year, 8], due: [year, 10, 15] },    // Sep-Oct → Nov-15
    { periodStart: [year, 10], due: [year + 1, 0, 15] },// Nov-Dec → next-Jan-15
    // First period of next year, only used when we're past the Nov-Dec deadline.
    { periodStart: [year + 1, 0], due: [year + 1, 2, 15] },
  ];

  // The deadline-window logic: pick the candidate whose due date is the
  // earliest one that is still ≥ today (i.e. has NOT yet passed).
  let pick = candidates[0]!;
  for (const c of candidates) {
    const dueIso = new Date(Date.UTC(c.due[0], c.due[1], c.due[2]));
    if (dueIso.getTime() >= now.getTime()) {
      pick = c;
      break;
    }
  }

  periodStartMonth = pick.periodStart[1];
  periodYear = pick.periodStart[0];
  // Suppress unused warning while still letting future special-casing
  // expand the logic.
  void dayOfMonth;

  const periodStart = new Date(Date.UTC(periodYear, periodStartMonth, 1));
  const periodEnd = new Date(Date.UTC(periodYear, periodStartMonth + 2, 1)); // exclusive
  const dueDate = new Date(Date.UTC(pick.due[0], pick.due[1], pick.due[2]));

  const startMonthName = periodStartMonth;
  const endMonthName = (periodStartMonth + 1) % 12;
  const labelEn = `${EN_MONTHS[startMonthName]}-${EN_MONTHS[endMonthName]}`;
  const labelHe = `${HE_MONTHS[startMonthName]}-${HE_MONTHS[endMonthName]}`;

  return {
    periodStart,
    periodEnd,
    dueDate,
    labelEn,
    labelHe,
    deadlineUpcoming: dueDate.getTime() >= now.getTime(),
  };
}

/**
 * True if the given VAT status files annually rather than bi-monthly.
 * Currently only `osek_patur`. Kept as a helper so future status additions
 * (e.g. quarterly filers) can pivot off one place.
 */
export function isAnnualFiler(vatStatus: VatStatus): boolean {
  return vatStatus === "osek_patur";
}

/**
 * Number of whole days between `from` and `to` (signed, integer floor).
 * Helper used by callers to decide "≤ 7 days" thresholds.
 */
export function daysBetween(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}
