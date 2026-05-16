"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowUpRight,
  PieChart,
  Plus,
  TrendingUp,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import KpiCard from "@/components/app/KpiCard";
import RevenueEbitdaChart, {
  type RevenueEbitdaPoint,
} from "@/components/app/charts/RevenueEbitdaChart";
import type { DashboardKpis } from "@/lib/aggregations/dashboardData";

type Props = {
  chartData: RevenueEbitdaPoint[];
  kpis: DashboardKpis;
  isEmpty: boolean;
};

function formatCurrencyShort(value: number): string {
  // Compact ILS formatting for the KPI tiles. Uses Intl with sensible
  // fallback when running outside the supported runtime.
  try {
    return new Intl.NumberFormat("en-IL", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

export default function DashboardView({ chartData, kpis, isEmpty }: Props) {
  const t = useTranslations("app.dashboard");
  const tChart = useTranslations("app.dashboard.chart");

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label={tChart("kpiArr")}
          value={`₪${formatCurrencyShort(kpis.arrEstimate)}`}
          delta={tChart("kpiYoyDelta")}
          subtle
        />
        <KpiCard
          icon={Activity}
          label={tChart("kpiGm")}
          value={`${kpis.grossMarginPct.toFixed(1)}%`}
          subtle
        />
        <KpiCard
          icon={PieChart}
          label={tChart("kpiEbitda")}
          value={`₪${formatCurrencyShort(kpis.ebitdaSum)}`}
          subtle
        />
        <KpiCard
          icon={TrendingUp}
          label={tChart("kpiYoy")}
          value={`${kpis.yoyPct.toFixed(0)}%`}
          delta={tChart("kpiYoyDelta")}
          subtle
        />
      </div>

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
