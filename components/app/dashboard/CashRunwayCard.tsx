"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { CashRunway } from "@/lib/aggregations/cashRunway";

function fmtCurrency(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function CashRunwayCard({
  data,
  locale,
}: {
  data: CashRunway;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.cashRunway");

  const isPositive = data.monthsRemaining === null;
  const isDepleted = data.monthsRemaining === 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const accent = isPositive
    ? "text-emerald-300"
    : isDepleted
      ? "text-red-300"
      : "text-amber-300";

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
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
        <Icon size={16} className={`shrink-0 ${accent}`} />
      </header>

      <div className="flex items-baseline gap-2" dir="ltr">
        <span className={`text-4xl font-semibold tracking-tight ${accent}`}>
          {isPositive
            ? "∞"
            : isDepleted
              ? "0"
              : data.monthsRemaining!.toFixed(1)}
        </span>
        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
          {isPositive
            ? t("positive")
            : isDepleted
              ? t("depleted")
              : t("monthsLabel")}
        </span>
      </div>

      {!isPositive && (
        <p className="text-[11px] text-slate-400">
          {t("burnLabel")}:{" "}
          <span dir="ltr" className="font-medium text-slate-300">
            {fmtCurrency(data.avgMonthlyNetBurnMajor, locale)}
          </span>
        </p>
      )}
    </motion.article>
  );
}
