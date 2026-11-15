import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import DashboardView from "./DashboardView";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { getOnboardingState } from "@/lib/aggregations/onboardingState";
import {
  getDashboardData,
  labelForMonthIdx,
} from "@/lib/aggregations/dashboardData";
import { getCashOnHand } from "@/lib/aggregations/cashOnHand";
import { getOverdueInvoices } from "@/lib/aggregations/overdueInvoices";
import { getUncategorisedReceipts } from "@/lib/aggregations/uncategorisedReceipts";
import { getAdvanceTaxStatus } from "@/lib/aggregations/advanceTaxStatus";
import { getMonthlyProfitTrend } from "@/lib/aggregations/monthlyProfitTrend";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";
import { getRecurringSubscriptions } from "@/lib/aggregations/recurringSubscriptions";
import { getSpendingByCategory } from "@/lib/aggregations/spendingByCategory";
import { getCashRunway } from "@/lib/aggregations/cashRunway";
import { getUpcomingObligations } from "@/lib/aggregations/upcomingObligations";
import { getCurrentVatWindow, daysBetween } from "@/lib/scheduler/businessQuotedRevenueWindow";
import MorningBriefCardServer from "@/components/app/dashboard/MorningBriefCard.server";
import ReadinessBanner from "@/components/app/dashboard/ReadinessBanner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.dashboard" });
  return { title: t("metaTitle") };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();

  // Hard gate: no business yet → push them through onboarding. The
  // (app) layout already verified the session; this layer enforces
  // the *product* prerequisite.
  const state = await getOnboardingState(user.appUserId);
  if (!state.hasBusiness) {
    redirect(`/${locale}/onboarding` as Route);
  }

  // Run every tile aggregation in parallel so the page lands in a
  // single round-trip worth of network time.
  const now = new Date();
  const [
    data,
    cashOnHand,
    overdueInvoices,
    uncategorisedReceipts,
    advanceTaxStatus,
    profitTrend,
    estimate,
    spendingByCategory,
    recurringSubs,
    upcomingObligations,
    cashRunway,
  ] = await Promise.all([
    getDashboardData(user.appUserId),
    getCashOnHand(user.appUserId),
    getOverdueInvoices(user.appUserId),
    getUncategorisedReceipts(user.appUserId),
    getAdvanceTaxStatus(user.appUserId),
    getMonthlyProfitTrend(user.appUserId),
    runFullTaxEngine(user.appUserId, { now }),
    getSpendingByCategory(user.appUserId, { now }),
    getRecurringSubscriptions(user.appUserId, { now }),
    getUpcomingObligations(user.appUserId, { now }),
    getCashRunway(user.appUserId, { now }),
  ]);

  const vatWindow = getCurrentVatWindow(now);
  const dueIso = vatWindow.dueDate.toISOString().slice(0, 10);
  const daysUntilDue = daysBetween(now, vatWindow.dueDate);
  const periodLabel = locale === "he-IL" ? vatWindow.labelHe : vatWindow.labelEn;
  const vatPayableMajor = Number(estimate.vatPayableThisPeriodMinor) / 100;

  // Pre-translate the month labels on the server so the chart can
  // ship as a pure presentational component.
  const t = await getTranslations("app.dashboard");
  let months: string[];
  try {
    const raw = t.raw("months");
    months = Array.isArray(raw) ? (raw as string[]) : [];
  } catch {
    months = [];
  }

  const chartData = data.rows.map((row) => ({
    month: labelForMonthIdx(row.monthIdx, months),
    revenue: row.revenue,
    ebitda: row.ebitda,
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Owner-side production blockers (domain / Turnstile / Stripe /
          CPA / Resend). Hidden automatically once every check passes. */}
      <ReadinessBanner />
      {/* Morning Tax Brief — Product council pick (docs/council/
          2026-05-16-product-review.md §7). Renders above the KPI grid so
          the user sees "what to do today" before "how am I doing overall". */}
      <MorningBriefCardServer locale={locale} />
      <DashboardView
        chartData={chartData}
        isEmpty={data.isEmpty}
        locale={locale}
        monthLabels={months}
        vatDue={{
          amountMajor: vatPayableMajor,
          daysUntilDue,
          dueDateIso: dueIso,
          periodLabel,
        }}
        cashOnHand={cashOnHand}
        overdueInvoices={overdueInvoices}
        uncategorisedReceipts={uncategorisedReceipts}
        advanceTaxStatus={advanceTaxStatus}
        profitTrend={profitTrend}
        spendingByCategory={spendingByCategory}
        recurringSubs={recurringSubs}
        upcomingObligations={upcomingObligations}
        cashRunway={cashRunway}
        nowIso={now.toISOString().slice(0, 10)}
      />
    </div>
  );
}
