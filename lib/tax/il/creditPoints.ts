// Credit-point (נקודת זיכוי) defaulter for the IL income tax engine.
//
// Sources (fetched 2026-05-16):
//   PwC tax summaries Israel — "Other tax credits and incentives"
//   cwsisrael.com 2026 changes guide
//   kolzchut.org.il (immigrant credit points)
//
// Baseline (resident):
//   Every Israeli resident → 2.25 points (men) or 2.75 points (women,
//   includes the "women's additional 0.5 point"). The baseline 2.25 is
//   itself the sum of the standard "resident" 2.0 + the "Israeli
//   resident addition" 0.25.
//
// Children:
//   Both parents share the children's points, conventionally with the
//   mother declaring most categories. Per child:
//     < 6 yrs   → 2.5 points (newborn first year is 1.5)
//     6–17 yrs  → 1 point
//     age 18    → 1 point (transitional)
//
// Single parent (משפחה חד-הורית): +1 additional point.
//
// New immigrant (עולה חדש, post-aliyah benefit) — staggered schedule
// per Income Tax Ordinance §35 (and Amendment 2026):
//   months 1-18  → 1/4 annual point per month (×12 = 3 points/yr peak)
//   months 19-30 → 1/6 annual point per month
//   months 31-42 → 1/12 annual point per month
//   months >42   → 0
//
// Returning resident (תושב חוזר ותיק) — symmetric to oleh schedule.
// Modelled here via `monthsSinceAliyah` (we don't distinguish at the
// engine level; the UI form picks the appropriate category and feeds
// the same field).
//
// Reserve duty (חיילי מילואים, Amendment 2026) — granted for the
// PRIOR tax year. Schedule per the official ITA guidance:
//   < 10 days   → 0 points
//   10-19 days  → 1 point
//   20-49 days  → 2 points
//   50-79 days  → 3 points
//   80-109 days → 4 points
//   ≥110 days   → up to 4 points per the 2026 program
//
// Returning IDF combat soldier (חייל משוחרר) — 2 points/yr in the 3
// years after discharge if combat-eligible. Modelled simply as a flat
// "yearsSinceIdfDischarge ∈ [1,3]".

import type { CreditPointBreakdown, CreditPointInputs } from "./types";

function residentBaseline(isFemale: boolean): number {
  // The "Israeli resident addition" of 0.25 is included in 2.25/2.75
  // because every resident gets it. UI doesn't need to expose it.
  return isFemale ? 2.75 : 2.25;
}

function childPointsTotal(input: CreditPointInputs): number {
  return (
    input.childrenUnder6 * 2.5 +
    input.childrenAged6To17 * 1 +
    input.childrenAged18 * 1
  );
}

function olehMonthlyPoint(month: number): number {
  if (month <= 0) return 0;
  if (month <= 18) return 1 / 4;
  if (month <= 30) return 1 / 6;
  if (month <= 42) return 1 / 12;
  return 0;
}

function olehAnnualPoints(monthsSinceAliyah: number | null): number {
  if (monthsSinceAliyah == null || monthsSinceAliyah <= 0) return 0;
  // Sum a year's worth of monthly fractions starting at month-since-aliyah
  // and walking forward 12 months. This handles partial-year overlap with
  // the 18/30/42 boundaries correctly.
  let sum = 0;
  for (let m = monthsSinceAliyah; m < monthsSinceAliyah + 12; m++) {
    sum += olehMonthlyPoint(m);
  }
  return sum;
}

function reserveDutyPoints(days: number | null): number {
  if (days == null || days <= 0) return 0;
  if (days < 10) return 0;
  if (days < 20) return 1;
  if (days < 50) return 2;
  if (days < 80) return 3;
  return 4;
}

function idfReturneePoints(years: number | null): number {
  if (years == null || years <= 0) return 0;
  if (years > 3) return 0;
  return 2;
}

export function defaultCreditPoints(input: CreditPointInputs): CreditPointBreakdown {
  if (!input.isResident) {
    return {
      totalPoints: 0,
      components: [
        {
          label: "non_resident",
          points: 0,
          rationale: "non-residents are not entitled to credit points",
        },
      ],
    };
  }

  const components: Array<{ label: string; points: number; rationale: string }> = [];

  const baseline = residentBaseline(input.isFemale);
  components.push({
    label: "resident_baseline",
    points: baseline,
    rationale: input.isFemale
      ? "Israeli female resident baseline (2.0 resident + 0.25 resident-add + 0.5 woman)"
      : "Israeli male resident baseline (2.0 resident + 0.25 resident-add)",
  });

  const childPoints = childPointsTotal(input);
  if (childPoints > 0) {
    components.push({
      label: "children",
      points: childPoints,
      rationale: `under-6: ${input.childrenUnder6} × 2.5 + 6-17: ${input.childrenAged6To17} × 1 + age-18: ${input.childrenAged18} × 1`,
    });
  }

  if (input.isSingleParent) {
    components.push({
      label: "single_parent",
      points: 1,
      rationale: "msh'pacha chad-horit (single-parent family) +1",
    });
  }

  const oleh = olehAnnualPoints(input.monthsSinceAliyah);
  if (oleh > 0) {
    components.push({
      label: "oleh_chadash",
      points: oleh,
      rationale: `staggered Olim schedule, month ${input.monthsSinceAliyah} ahead`,
    });
  }

  const reserve = reserveDutyPoints(input.reserveDutyDays);
  if (reserve > 0) {
    components.push({
      label: "reserve_duty",
      points: reserve,
      rationale: `${input.reserveDutyDays} reserve days (Amendment 2026)`,
    });
  }

  const idfRet = idfReturneePoints(input.yearsSinceIdfDischarge);
  if (idfRet > 0) {
    components.push({
      label: "idf_returnee",
      points: idfRet,
      rationale: `combat soldier within 3 years of discharge: +${idfRet}`,
    });
  }

  const totalPoints = components.reduce((acc, c) => acc + c.points, 0);
  return { totalPoints, components };
}
