"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import RevenueEbitdaChart, {
  type RevenueEbitdaPoint,
} from "@/components/app/charts/RevenueEbitdaChart";
import VatDueCard from "@/components/app/dashboard/VatDueCard";
import CashOnHandCard from "@/components/app/dashboard/CashOnHandCard";
import OverdueInvoicesCard from "@/components/app/dashboard/OverdueInvoicesCard";
import UncategorisedReceiptsCard from "@/components/app/dashboard/UncategorisedReceiptsCard";
import MakdamotCard from "@/components/app/dashboard/MakdamotCard";
import MonthlyProfitTrendChart from "@/components/app/dashboard/MonthlyProfitTrendChart";
import type { CashOnHand } from "@/lib/aggregations/cashOnHand";
import type { OverdueInvoices } from "@/lib/aggregations/overdueInvoices";
import type { UncategorisedReceipts } from "@/lib/aggregations/uncategorisedReceipts";
import type { AdvanceTaxStatus } from "@/lib/aggregations/advanceTaxStatus";
import type { MonthlyProfitTrend } from "@/lib/aggregations/monthlyProfitTrend";

type VatDue = {
  amountMajor: number;
  daysUntilDue: number;
  dueDateIso: string;
  periodLabel: string;
};

type Props = {
  /** 12-month revenue/profit series, for the secondary chart. */
  chartData: RevenueEbitdaPoint[];
  isEmpty: boolean;
  locale: string;
  /** Pre-translated short month names. */
  monthLabels: string[];
  vatDue: VatDue;
  cashOnHand: CashOnHand;
  overdueInvoices: OverdueInvoices;
  uncategorisedReceipts: UncategorisedReceipts;
  advanceTaxStatus: AdvanceTaxStatus;
  profitTrend: MonthlyProfitTrend;
};

export default function DashboardView({
  chartData,
  isEmpty,
  locale,
  monthLabels,
  vatDue,
  cashOnHand,
  overdueInvoices,
  uncategorisedReceipts,
  advanceTaxStatus,
  profitTrend,
}: Props) {
  const t = useTranslations("app.dashboard");

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </header>

      {/* The 6 canonical CPA-relevant tiles. Layout: 1 / 2-3 / 4-5 stacked
          on mobile, 2-up on sm, 3-up on lg. The profit-trend chart spans
          the full row width via its own col-span hint. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <VatDueCard
          amountMajor={vatDue.amountMajor}
          daysUntilDue={vatDue.daysUntilDue}
          dueDateIso={vatDue.dueDateIso}
          periodLabel={vatDue.periodLabel}
          locale={locale}
        />
        <CashOnHandCard
          totalMajor={cashOnHand.totalMajor}
          accountCount={cashOnHand.accountCount}
          locale={locale}
        />
        <OverdueInvoicesCard
          count={overdueInvoices.count}
          totalMajor={overdueInvoices.totalMajor}
          locale={locale}
        />
        <UncategorisedReceiptsCard
          count={uncategorisedReceipts.count}
          totalMajor={uncategorisedReceipts.totalMajor}
          locale={locale}
        />
        {advanceTaxStatus.available ? (
          <MakdamotCard
            available
            dueMajor={advanceTaxStatus.dueMajor}
            paidMajor={advanceTaxStatus.paidMajor}
            balanceMajor={advanceTaxStatus.balanceMajor}
            installmentCount={advanceTaxStatus.installmentCount}
            locale={locale}
          />
        ) : (
          <MakdamotCard available={false} locale={locale} />
        )}
        <MonthlyProfitTrendChart
          data={profitTrend.rows}
          monthLabels={monthLabels}
          locale={locale}
        />
      </div>

      {/* Secondary 12-month bar chart — kept as Product council § 3
          recommended ("keep the revenue-vs-profit bar chart as a
          secondary section, NOT the hero"). */}
      <RevenueEbitdaChart data={chartData} />

      {isEmpty && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-strong relative flex flex-col items-start gap-3 rounded-2xl p-6"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Plus size={16} />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-100">
            {t("empty.title")}
          </h2>
          <p className="max-w-md text-sm text-slate-400">{t("empty.desc")}</p>
          <Link
            // Transactions UI lives in chunk B. The route may not exist
            // yet at typecheck time — cast to bypass typedRoutes until
            // chunk B's page lands.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            href={"/transactions" as any}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
          >
            {t("empty.cta")}
            <ArrowUpRight size={14} />
          </Link>
        </motion.div>
      )}
    </div>
  );
}
