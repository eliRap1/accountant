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
import MorningBriefCardServer from "@/components/app/dashboard/MorningBriefCard.server";

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

  const data = await getDashboardData(user.appUserId);

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
      {/* Morning Tax Brief — Product council pick (docs/council/
          2026-05-16-product-review.md §7). Renders above the KPI grid so
          the user sees "what to do today" before "how am I doing overall". */}
      <MorningBriefCardServer locale={locale} />
      <DashboardView
        chartData={chartData}
        kpis={data.kpis}
        isEmpty={data.isEmpty}
      />
    </div>
  );
}
