"use client";

import { useTranslations } from "next-intl";

// Visual bracket-walk: shows each bracket as a horizontal bar with the
// slice of income that hit it. Uses CSS-only flexbox so it ships
// without recharts overhead (the dashboard chart is heavier; this is
// purpose-built for sub-tab use where size + first-paint matter).

export type SerialisedBracket = {
  rangeFromMinor: string;
  rangeToMinor: string | null;
  ratePct: number;
  slicedIncomeMinor: string;
  taxOnSliceMinor: string;
};

type Props = {
  breakdown: SerialisedBracket[];
  marginalRatePct: number;
  effectiveRatePct: number;
  surtaxMinor: string;
  locale: string;
};

function fmt(minor: string, locale: string): string {
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

export default function IncomeTaxBracketChart({
  breakdown,
  marginalRatePct,
  effectiveRatePct,
  surtaxMinor,
  locale,
}: Props) {
  const t = useTranslations("app.tax.yearEnd");

  // Compute proportional widths from the bracket slices.
  let maxSlice = 0;
  for (const b of breakdown) {
    const s = Number(b.slicedIncomeMinor);
    if (s > maxSlice) maxSlice = s;
  }
  if (maxSlice === 0) maxSlice = 1;

  return (
    <section
      className="rounded-2xl border border-white/5 bg-slate-950/40 p-5"
      aria-label={t("bracketChartTitle")}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-200">
          {t("bracketChartTitle")}
        </h2>
        <p className="text-xs text-slate-500">
          {t("marginalRate", {
            pct: (marginalRatePct * 100).toFixed(0),
          })}{" "}
          ·{" "}
          {t("effectiveRate", {
            pct: (
              (effectiveRatePct < 0 ? 0 : effectiveRatePct) * 100
            ).toFixed(1),
          })}
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {breakdown.map((bracket, idx) => {
          const width = Math.max(
            4,
            Math.round((Number(bracket.slicedIncomeMinor) / maxSlice) * 100),
          );
          const rangeStr =
            bracket.rangeToMinor === null
              ? `${fmt(bracket.rangeFromMinor, locale)} +`
              : `${fmt(bracket.rangeFromMinor, locale)} → ${fmt(bracket.rangeToMinor, locale)}`;
          return (
            <li key={`${idx}-${bracket.ratePct}`} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="text-slate-400">
                  {(bracket.ratePct * 100).toFixed(0)}% · {rangeStr}
                </span>
                <span className="font-medium text-slate-200" dir="ltr">
                  {fmt(bracket.taxOnSliceMinor, locale)}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-white/5"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 to-emerald-500/40"
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>

      {Number(surtaxMinor) > 0 ? (
        <p className="mt-3 text-xs text-rose-200/80">
          {t("surtaxNote", { amount: fmt(surtaxMinor, locale) })}
        </p>
      ) : null}
    </section>
  );
}
