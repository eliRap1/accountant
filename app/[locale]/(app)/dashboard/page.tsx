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

export const metadata = {
  title: "Dashboard · AccounTech",
};

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
    <DashboardView
      chartData={chartData}
      kpis={data.kpis}
      isEmpty={data.isEmpty}
    />
  );
}
