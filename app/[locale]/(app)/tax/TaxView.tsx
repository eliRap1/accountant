"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Route } from "next";
import TaxSummaryCard from "@/components/app/tax/TaxSummaryCard";
import VatBreakdown from "@/components/app/tax/VatBreakdown";
import IncomeTaxBracketChart from "@/components/app/tax/IncomeTaxBracketChart";

// Phase D tax sub-tabs container.
//
// Three sub-tabs (מע״מ / מקדמות / סיום שנה) all consume slices of the
// same `TaxEstimate` snapshot. The active tab is driven by `?tab=...`
// search param so each tab is fully linkable and deep-linkable.
// Server fetches once; client renders the active slice.

export type SerialisedIncomeTaxBracketBreakdown = {
  rangeFromMinor: string;
  rangeToMinor: string | null;
  ratePct: number;
  slicedIncomeMinor: string;
  taxOnSliceMinor: string;
};

export type SerialisedIncomeTaxResult = {
  grossTaxMinor: string;
  creditValueMinor: string;
  netTaxMinor: string;
  marginalRatePct: number;
  effectiveRatePct: number;
  surtaxMinor: string;
  breakdown: SerialisedIncomeTaxBracketBreakdown[];
};

export type SerialisedBituachLeumiResult = {
  employeeContribMinor: string;
  employerContribMinor: string;
  selfContribMinor: string;
  totalContribMinor: string;
};

export type SerialisedTaxEstimate = {
  year: number;
  rulesVersion: string;
  rulesHumanReviewed: boolean;
  incomeMinor: string;
  expensesMinor: string;
  vatPayableThisPeriodMinor: string;
  activeAllocationThresholdMinor: string;
  advanceTaxMonthlyInstallmentMinor: string | null;
  advanceTaxRateRange: { minPct: number; maxPct: number };
  incomeTax: SerialisedIncomeTaxResult | null;
  bituachLeumi: SerialisedBituachLeumiResult | null;
};

export type TaxViewProps = {
  estimate: SerialisedTaxEstimate;
  activeTab: "vat" | "makdamot" | "year-end";
  locale: string;
};

type Tab = TaxViewProps["activeTab"];

const TABS: ReadonlyArray<{ key: Tab; tKey: string }> = [
  { key: "vat", tKey: "tabs.vat" },
  { key: "makdamot", tKey: "tabs.makdamot" },
  { key: "year-end", tKey: "tabs.yearEnd" },
] as const;

function formatCurrency(minor: string, locale: string): string {
  // Minor → major as a number (acceptable precision for IL tax UI: any
  // ILS value fits in IEEE 754 with sub-agora fidelity well below the
  // ₪10^12 mark we'll ever see).
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

function nextVatDueDate(now: Date): Date {
  // Bi-monthly VAT period: Jan-Feb / Mar-Apr / ... Filing deadline is
  // the 15th of the month AFTER the period closes (verified 2026-05-16
  // via avalara.com Israeli VAT returns guide).
  const monthIdx = now.getUTCMonth(); // 0-11
  const periodEndMonth = Math.floor(monthIdx / 2) * 2 + 1; // 1,3,5,7,9,11
  // VAT report is due the 15th of the month after the period ends.
  return new Date(Date.UTC(now.getUTCFullYear(), periodEndMonth + 1, 15));
}

function VatTab({ estimate, locale }: { estimate: SerialisedTaxEstimate; locale: string }) {
  const t = useTranslations("app.tax.vat");
  const now = new Date();
  const dueDate = nextVatDueDate(now);
  const daysUntilDue = Math.max(
    0,
    Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const dueDateStr = dueDate.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <TaxSummaryCard
        label={t("payableLabel")}
        value={formatCurrency(estimate.vatPayableThisPeriodMinor, locale)}
        helper={t("payableHelper")}
        tone="emphasis"
      />
      <TaxSummaryCard
        label={t("dueDateLabel")}
        value={dueDateStr}
        helper={t("dueDateHelper", { days: daysUntilDue })}
      />
      <TaxSummaryCard
        label={t("allocationThresholdLabel")}
        value={formatCurrency(estimate.activeAllocationThresholdMinor, locale)}
        helper={t("allocationThresholdHelper")}
      />
      <div className="lg:col-span-3">
        <VatBreakdown
          incomeMinor={estimate.incomeMinor}
          expensesMinor={estimate.expensesMinor}
          vatPayableMinor={estimate.vatPayableThisPeriodMinor}
          locale={locale}
        />
      </div>
    </div>
  );
}

function MakdamotTab({
  estimate,
  locale,
}: {
  estimate: SerialisedTaxEstimate;
  locale: string;
}) {
  const t = useTranslations("app.tax.makdamot");

  // Layer 3 dependency probe: the actual `tax_advances` rows live in a
  // table that isn't migrated yet. The dashboard panel renders the
  // schema-missing notice + the engine's installment projection as a
  // preview. The schema-missing detection is server-side (see
  // makdamot/page.tsx); from this view we just surface whichever data
  // the engine already produced.
  const monthlyInstallment = estimate.advanceTaxMonthlyInstallmentMinor;
  const hasRate = monthlyInstallment !== null;
  const rateRangePctMin = (estimate.advanceTaxRateRange.minPct * 100).toFixed(1);
  const rateRangePctMax = (estimate.advanceTaxRateRange.maxPct * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TaxSummaryCard
          label={t("monthlyInstallmentLabel")}
          value={
            monthlyInstallment !== null
              ? formatCurrency(monthlyInstallment, locale)
              : t("notAssigned")
          }
          helper={
            hasRate ? t("monthlyInstallmentHelper") : t("notAssignedHelper")
          }
          tone={hasRate ? "emphasis" : "muted"}
        />
        <TaxSummaryCard
          label={t("rateRangeLabel")}
          value={`${rateRangePctMin}% – ${rateRangePctMax}%`}
          helper={t("rateRangeHelper")}
        />
      </div>

      <aside
        className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        role="note"
      >
        <p className="font-medium">{t("layer3MissingTitle")}</p>
        <p className="mt-1 text-amber-200/90">{t("layer3MissingDesc")}</p>
      </aside>
    </div>
  );
}

function YearEndTab({
  estimate,
  locale,
}: {
  estimate: SerialisedTaxEstimate;
  locale: string;
}) {
  const t = useTranslations("app.tax.yearEnd");
  const incomeTax = estimate.incomeTax;
  const bituach = estimate.bituachLeumi;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <TaxSummaryCard
          label={t("netTaxLabel")}
          value={
            incomeTax !== null
              ? formatCurrency(incomeTax.netTaxMinor, locale)
              : "—"
          }
          helper={t("netTaxHelper", { year: estimate.year })}
          tone="emphasis"
        />
        <TaxSummaryCard
          label={t("creditValueLabel")}
          value={
            incomeTax !== null
              ? formatCurrency(incomeTax.creditValueMinor, locale)
              : "—"
          }
          helper={t("creditValueHelper")}
        />
        <TaxSummaryCard
          label={t("bituachLabel")}
          value={
            bituach !== null
              ? formatCurrency(bituach.totalContribMinor, locale)
              : "—"
          }
          helper={t("bituachHelper")}
        />
      </div>

      {incomeTax !== null ? (
        <IncomeTaxBracketChart
          breakdown={incomeTax.breakdown}
          marginalRatePct={incomeTax.marginalRatePct}
          effectiveRatePct={incomeTax.effectiveRatePct}
          surtaxMinor={incomeTax.surtaxMinor}
          locale={locale}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <p className="flex-1 text-sm text-slate-300">{t("prepPackDesc")}</p>
        <Link
          // The `/filings/form-1301` route is a Phase E surface that isn't
          // shipped yet — typedRoutes flags the href; cast keeps the CTA
          // available for navigation tests without faking the route.
          href={"/filings/form-1301" as Route}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
        >
          {t("prepPackCta")}
        </Link>
      </div>
    </div>
  );
}

export default function TaxView({ estimate, activeTab, locale }: TaxViewProps) {
  const t = useTranslations("app.tax");
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-5">
      <nav
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/5 bg-slate-950/40 p-1.5"
        aria-label={t("tabsLabel")}
      >
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          // Re-target the same pathname with the `tab` query swapped.
          // Using `Link` keeps locale-prefix handling consistent with
          // the rest of the app shell.
          const href =
            tab.key === "vat"
              ? (pathname as Route)
              : (`${pathname}?tab=${tab.key}` as Route);
          return (
            <Link
              key={tab.key}
              href={href}
              className={`relative inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-emerald-500/15 text-emerald-100"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive ? (
                <motion.span
                  layoutId="taxTabActive"
                  aria-hidden
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 -z-10 rounded-xl border border-emerald-400/30 bg-emerald-500/5"
                />
              ) : null}
              {t(tab.tKey as "tabs.vat")}
            </Link>
          );
        })}
      </nav>

      {activeTab === "vat" ? <VatTab estimate={estimate} locale={locale} /> : null}
      {activeTab === "makdamot" ? (
        <MakdamotTab estimate={estimate} locale={locale} />
      ) : null}
      {activeTab === "year-end" ? (
        <YearEndTab estimate={estimate} locale={locale} />
      ) : null}
    </div>
  );
}
