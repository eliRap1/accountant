"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// In-app analogue of components/site/sections/Dashboard.tsx — same
// glassmorphism, same emerald gradient bars, same custom tooltip,
// same mounted-state guard against recharts SSR hydration warnings.
//
// The component is intentionally agnostic about *what* numbers it
// gets: callers compute revenue and ebitda upstream
// (`lib/aggregations/dashboardData.ts`) and pass plain numbers in.
//
// Localisation: the eyebrow, title, description, FY label, axis legend
// strings all come from `app.dashboard.chart.*`. The month labels arrive
// pre-translated on the data rows so this component never needs to
// reach for the `months` array itself.

export type RevenueEbitdaPoint = {
  month: string;
  revenue: number;
  ebitda: number;
};

type Props = {
  data: RevenueEbitdaPoint[];
  /** Display the area sub-chart underneath the bars. Defaults to true. */
  showArea?: boolean;
};

export default function RevenueEbitdaChart({ data, showArea = true }: Props) {
  const t = useTranslations("app.dashboard.chart");

  const [hovered, setHovered] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const total = data.reduce((acc, d) => acc + d.revenue, 0);

  function CustomTooltip({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number; payload: RevenueEbitdaPoint }>;
    label?: string;
  }) {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]!.payload;
    return (
      <div className="glass-strong rounded-xl px-3.5 py-2.5 text-xs">
        <div className="mb-1 text-slate-400" dir="ltr">
          {label} {t("fy")}
        </div>
        <div className="flex items-center gap-2 text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {t("revenue")}:{" "}
          <span className="text-slate-100 font-semibold" dir="ltr">
            ₪{row.revenue.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          {t("ebitda")}:{" "}
          <span className="text-slate-100 font-semibold" dir="ltr">
            ₪{row.ebitda.toLocaleString()}
          </span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong relative overflow-hidden rounded-3xl p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute -end-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

      <div className="mb-6 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
            {t("eyebrow")}
          </span>
          <h3 className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight text-slate-50">
            {t("title")}
          </h3>
          <p className="mt-1 max-w-md text-sm text-slate-400">{t("desc")}</p>
        </div>
        <span className="text-xs text-slate-500" dir="ltr">
          {t("fy")} · ₪{total.toLocaleString()}
        </span>
      </div>

      <div
        className={`grid gap-6 ${
          showArea ? "lg:grid-cols-[1.6fr_1fr]" : "lg:grid-cols-1"
        }`}
      >
        <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-200">{t("barTitle")}</h4>
          </div>
          <div className="h-72" dir="ltr">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  onMouseMove={(s) =>
                    setHovered(
                      typeof s?.activeTooltipIndex === "number"
                        ? s.activeTooltipIndex
                        : null,
                    )
                  }
                  onMouseLeave={() => setHovered(null)}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="appBarFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient
                      id="appBarFillDim"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.18} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="#1e293b"
                    strokeDasharray="3 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    stroke="#64748b"
                    fontSize={11}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    stroke="#64748b"
                    fontSize={11}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(16,185,129,0.06)" }}
                    content={<CustomTooltip />}
                  />
                  <Bar
                    dataKey="revenue"
                    radius={[6, 6, 2, 2]}
                    animationDuration={1100}
                  >
                    {data.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          hovered === null || hovered === i
                            ? "url(#appBarFill)"
                            : "url(#appBarFillDim)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {showArea && (
          <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
            <h4 className="mb-2 text-sm font-medium text-slate-200">
              {t("ebitda")}
            </h4>
            <div className="h-44" dir="ltr">
              {mounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data}
                    margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="appAreaFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="ebitda"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#appAreaFill)"
                      animationDuration={1300}
                    />
                    <XAxis dataKey="month" hide />
                    <YAxis hide />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
