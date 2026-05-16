"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Repeat } from "lucide-react";
import type { RecurringSubscriptions } from "@/lib/aggregations/recurringSubscriptions";

function fmtCurrency(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function RecurringSubsCard({
  data,
  locale,
}: {
  data: RecurringSubscriptions;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.recurringSubs");
  const visible = data.subscriptions.slice(0, 6);
  const isEmpty = visible.length === 0;

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
        <p className="text-end text-sm font-semibold text-emerald-300" dir="ltr">
          {fmtCurrency(data.totalMonthlyMajor, locale)}
        </p>
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li
              key={`${s.vendor}::${s.cadence}`}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 truncate">
                <Repeat size={14} className="shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {s.vendor}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t("occurrences", { count: s.occurrences })}
                  </p>
                </div>
              </div>
              <p className="text-end text-sm text-slate-200" dir="ltr">
                {fmtCurrency(s.monthlyCostMajor, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </motion.article>
  );
}
