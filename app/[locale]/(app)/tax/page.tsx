import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";
import rulesMeta from "@/lib/tax/il/rules-2026.meta.json" with { type: "json" };
import TaxView, { type TaxViewProps } from "./TaxView";

// Phase D Tax surface.
//
// IA per `docs/council/2026-05-16-product-review.md` § 4: Tax is its own
// top-level item with three sub-tabs (מע״מ · מקדמות · סיום שנה). All
// sub-tabs render under this single page using a `tab` search param —
// this keeps the engine fetch a single round-trip and lets server
// components share state without going through middleware.
//
// Regulatory layer:
//   - <EstimatesDisclaimerBanner /> at top.
//   - When `rules-<year>.meta.json humanReviewed === false`, a red
//     "אומדנים בשלבי סקירה — אל תסתמכו" banner renders right under it.
//     After CPA sign-off (humanReviewed → true) the banner hides
//     automatically.

export const metadata = {
  title: "Tax · AccounTech",
};

type SearchParams = Promise<{ tab?: string }>;

const VALID_TABS = new Set(["vat", "makdamot", "year-end"]);

function asTab(value: string | undefined): "vat" | "makdamot" | "year-end" {
  if (value && VALID_TABS.has(value)) {
    return value as "vat" | "makdamot" | "year-end";
  }
  return "vat";
}

export default async function TaxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: SearchParams;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();
  const sp = (await searchParams) ?? {};
  const activeTab = asTab(sp.tab);

  // Run the full engine once on the server. Each sub-tab consumes a
  // slice of the same `TaxEstimate` — no per-tab round-trips.
  const estimate = await runFullTaxEngine(user.appUserId);

  const t = await getTranslations("app.tax");

  // Pre-serialise bigints to strings so the result crosses the
  // server→client boundary without React choking on a non-serialisable
  // BigInt. The view re-coerces what it needs back to bigint locally.
  const serialised: TaxViewProps["estimate"] = {
    year: estimate.year,
    rulesVersion: estimate.rulesVersion,
    rulesHumanReviewed: estimate.rulesHumanReviewed,
    incomeMinor: estimate.incomeMinor.toString(),
    expensesMinor: estimate.expensesMinor.toString(),
    vatPayableThisPeriodMinor: estimate.vatPayableThisPeriodMinor.toString(),
    activeAllocationThresholdMinor: estimate.activeAllocationThresholdMinor.toString(),
    advanceTaxMonthlyInstallmentMinor:
      estimate.advanceTaxMonthlyInstallmentMinor === null
        ? null
        : estimate.advanceTaxMonthlyInstallmentMinor.toString(),
    advanceTaxRateRange: estimate.advanceTaxRateRange,
    incomeTax:
      estimate.incomeTax === null
        ? null
        : {
            grossTaxMinor: estimate.incomeTax.grossTaxMinor.toString(),
            creditValueMinor: estimate.incomeTax.creditValueMinor.toString(),
            netTaxMinor: estimate.incomeTax.netTaxMinor.toString(),
            marginalRatePct: estimate.incomeTax.marginalRatePct,
            effectiveRatePct: estimate.incomeTax.effectiveRatePct,
            surtaxMinor: estimate.incomeTax.surtaxMinor.toString(),
            breakdown: estimate.incomeTax.breakdown.map((b) => ({
              rangeFromMinor: b.rangeFromMinor.toString(),
              rangeToMinor:
                b.rangeToMinor === null ? null : b.rangeToMinor.toString(),
              ratePct: b.ratePct,
              slicedIncomeMinor: b.slicedIncomeMinor.toString(),
              taxOnSliceMinor: b.taxOnSliceMinor.toString(),
            })),
          },
    bituachLeumi:
      estimate.bituachLeumi === null
        ? null
        : {
            employeeContribMinor:
              estimate.bituachLeumi.employeeContribMinor.toString(),
            employerContribMinor:
              estimate.bituachLeumi.employerContribMinor.toString(),
            selfContribMinor:
              estimate.bituachLeumi.selfContribMinor.toString(),
            totalContribMinor:
              estimate.bituachLeumi.totalContribMinor.toString(),
          },
  };

  // rules-2026.meta.json carries the CPA review gate. While it's still
  // `humanReviewed: false`, every tax surface MUST surface a red banner
  // warning users not to rely on the numbers. Once a CPA signs off the
  // banner hides automatically.
  const rulesReviewed = rulesMeta.humanReviewed === true;
  const rulesReviewer = rulesMeta.reviewer ?? null;
  const rulesReviewedOn = rulesMeta.reviewedOn ?? null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <EstimatesDisclaimerBanner />

      {!rulesReviewed ? (
        <aside
          className="flex flex-col gap-1 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
          role="alert"
        >
          <p className="font-medium" dir="rtl" lang="he">
            {t("reviewBanner.he")}
          </p>
          <p className="text-rose-200/80" dir="ltr" lang="en">
            {t("reviewBanner.en")}
          </p>
          <p className="text-xs text-rose-300/80">
            {t("reviewBanner.note", {
              version: estimate.rulesVersion,
              reviewer: rulesReviewer ?? "—",
              reviewedOn: rulesReviewedOn ?? "—",
            })}
          </p>
        </aside>
      ) : null}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </header>

      <TaxView estimate={serialised} activeTab={activeTab} locale={locale} />
    </div>
  );
}
