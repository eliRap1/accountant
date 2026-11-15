"use client";

import { useTranslations } from "next-intl";

// VAT this-period breakdown: subtotal, vat collected, vat input
// recovery, net payable. Per `lib/tax/il/vat.ts` the engine returns
// `vatPayableThisPeriodMinor` as the clamped net payable; we approximate
// the collected/paid split from the income / expense aggregates so the
// UI can show "you collected X and recovered Y, net is Z" — a tighter
// story than the single net number. Numbers are presentational
// estimates only; the engine's authoritative net is rendered last.

type Props = {
  incomeMinor: string;
  expensesMinor: string;
  vatPayableMinor: string;
  locale: string;
};

const VAT_RATE = 0.18; // IL standard rate 2026 — confirmed via lib/tax/il/rules-2026.ts

function fmt(minor: bigint, locale: string): string {
  const value = Number(minor) / 100;
  try {
    return new Intl.NumberFormat(locale === "he-IL" ? "he-IL" : "en-IL", {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₪${Math.round(value).toLocaleString("en-US")}`;
  }
}

export default function VatBreakdown({
  incomeMinor,
  expensesMinor,
  vatPayableMinor,
  locale,
}: Props) {
  const t = useTranslations("app.tax.vat");
  const incomeBig = BigInt(incomeMinor);
  const expensesBig = BigInt(expensesMinor);
  const payableBig = BigInt(vatPayableMinor);

  // Reverse-derive period-share collected/recovered from the YTD
  // aggregates: assume two-month period ≈ 1/6 of the year. The engine
  // returns the AUTHORITATIVE net; we surface the split as a tooltip-
  // style breakdown only.
  const PERIOD_FRACTION = 100n; // multiplier; we divide by 600 → 1/6
  const periodIncome = (incomeBig * PERIOD_FRACTION) / 600n;
  const periodExpenses = (expensesBig * PERIOD_FRACTION) / 600n;
  // Approximate VAT collected/recovered from period subtotals.
  const periodSubtotalIncome = approxSubtotal(periodIncome);
  const periodVatCollected = periodIncome - periodSubtotalIncome;
  const periodVatRecovered = approxVatPortion(periodExpenses);

  return (
    <section
      className="rounded-2xl border border-white/5 bg-slate-950/40 p-5"
      aria-label={t("breakdownTitle")}
    >
      <h2 className="text-sm font-medium text-slate-200">
        {t("breakdownTitle")}
      </h2>
      <p className="mt-1 text-xs text-slate-500">{t("breakdownHelper")}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("statSubtotal")} value={fmt(periodSubtotalIncome, locale)} />
        <Stat label={t("statCollected")} value={fmt(periodVatCollected, locale)} />
        <Stat label={t("statRecovered")} value={fmt(periodVatRecovered, locale)} />
        <Stat label={t("statNet")} value={fmt(payableBig, locale)} emphasis />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {label}
      </dt>
      <dd
        className={`text-lg font-semibold ${
          emphasis ? "text-emerald-200" : "text-slate-100"
        }`}
        dir="ltr"
      >
        {value}
      </dd>
    </div>
  );
}

// Approximate pre-VAT subtotal from a VAT-inclusive total. Mirrors
// lib/tax/il/vat.ts splitVatInclusive but operates without importing
// the rules object — used only for the tooltip-style preview.
function approxSubtotal(totalMinor: bigint): bigint {
  if (totalMinor <= 0n) return 0n;
  const SCALE = 1_000_000n;
  const oneScaled = SCALE + BigInt(Math.round(VAT_RATE * Number(SCALE)));
  return (totalMinor * SCALE + oneScaled / 2n) / oneScaled;
}

function approxVatPortion(totalMinor: bigint): bigint {
  const subtotal = approxSubtotal(totalMinor);
  return totalMinor - subtotal;
}
