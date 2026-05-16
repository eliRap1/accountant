"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";

// 6-month profit trend line chart — Product council § 3 tile #6.
//
// Why a 6-month window instead of 12: the עצמאי persona doesn't think
// in fiscal years. They think "am I doing better or worse than 6
// months ago?" — short enough to remember, long enough to smooth a
// bad month. Bigger 12-month picture stays on the secondary
// RevenueEbitdaChart underneath.

export type MonthlyProfitPoint = {
  /** 0..11 zero-indexed month. */
  monthIdx: number;
  monthKey: string;
  profit: number;
};

type Props = {
  data: MonthlyProfitPoint[];
  /** Pre-translated short month labels (length 12). */
  monthLabels: string[];
  locale: string;
};

function formatCurrencyShort(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "he-IL" ? "he-IL" : "en-IL", {
      notation: "compact",
      maximumFractionDigits: 1,
      currency: "ILS",
      style: "currency",
    }).format(value);
  } catch {
    return `₪${Math.round(value).toLocaleString("en-US")}`;
  }
}

export default function MonthlyProfitTrendChart({
  data,
  monthLabels,
  locale,
}: Props) {
  const t = useTranslations("app.dashboard.tiles.monthlyProfitTrend");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const labelled = data.map((row) => ({
    ...row,
    month: monthLabels[row.monthIdx] ?? row.monthKey.slice(-2),
  }));

  // Compute Y-axis padding so a flat-zero series still renders a baseline.
  const max = Math.max(0, ...labelled.map((d) => d.profit));
  const min = Math.min(0, ...labelled.map((d) => d.profit));

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="col-span-1 flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-950/50 p-5 sm:col-span-2 lg:col-span-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
          <TrendingUp size={13} className="text-emerald-300" />
          {t("label")}
        </div>
        <span className="text-[11px] text-slate-500">{t("window")}</span>
      </div>
      <div className="h-44 w-full">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={labelled}
              margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="rgba(148,163,184,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                hide
                domain={[min - Math.abs(min) * 0.1, max + max * 0.1 || 100]}
              />
              <Tooltip
                cursor={{ stroke: "rgba(16,185,129,0.25)", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const value = payload[0]?.value as number;
                  return (
                    <div className="rounded-lg border border-white/10 bg-slate-950/95 px-3 py-2 text-xs">
                      <div className="text-slate-400">{label}</div>
                      <div
                        className="mt-1 text-sm font-medium text-slate-50"
                        dir="ltr"
                      >
                        {formatCurrencyShort(value, locale)}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3, fill: "#10b981" }}
                activeDot={{ r: 5 }}
                isAnimationActive
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          // SSR-safe placeholder — same height to prevent layout jump.
          <div className="h-full w-full" aria-hidden />
        )}
      </div>
    </motion.article>
  );
}
