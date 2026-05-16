"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { SpendingByCategory } from "@/lib/aggregations/spendingByCategory";

const SLICE_COLORS = [
  "#34d399",
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#fb923c",
  "#f87171",
  "#94a3b8",
  "#60a5fa",
  "#4ade80",
  "#fcd34d",
  "#c084fc",
];

function shilling(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function SpendingByCategoryCard({
  data,
  locale,
}: {
  data: SpendingByCategory;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.spendingByCategory");

  const slices = data.rows.map((r, idx) => ({
    name: r.categoryName ?? t("uncategorised"),
    code: r.categoryCode ?? "—",
    value: r.totalMajor,
    color: SLICE_COLORS[idx % SLICE_COLORS.length] ?? "#94a3b8",
  }));

  const isEmpty = data.rows.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium tracking-tight text-slate-200">
            {t("title")}
          </h3>
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {t("subtitle")}
          </p>
        </div>
        <p className="text-end text-sm font-semibold text-emerald-300" dir="ltr">
          {shilling(data.totalMajor, locale)}
        </p>
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="h-32 w-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  innerRadius={32}
                  outerRadius={56}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                  stroke="none"
                >
                  {slices.map((s) => (
                    <Cell key={s.code} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1.5">
            {slices.slice(0, 5).map((s) => (
              <li
                key={s.code}
                className="flex items-center justify-between text-xs text-slate-300"
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
                <span dir="ltr" className="ms-2 font-medium text-slate-100">
                  {shilling(s.value, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
