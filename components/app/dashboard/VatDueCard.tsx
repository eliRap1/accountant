"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Calendar, Receipt } from "lucide-react";

// VAT due this period — tile #1 on the new dashboard (Product council
// § 3). Shows the net VAT payable plus a countdown to the upcoming
// filing deadline. Traffic-light colour: red when ≤ 7 days, amber when
// ≤ 14, otherwise neutral emerald.
//
// All currency formatting is locale-aware via Intl. The number itself
// renders in an `dir="ltr"` wrapper so the ₪ symbol orders correctly
// in Hebrew.

type Props = {
  /** Net VAT payable, in MAJOR units (₪). */
  amountMajor: number;
  /** Days until the filing deadline. Negative if already past. */
  daysUntilDue: number;
  /** ISO date string for the deadline (YYYY-MM-DD). */
  dueDateIso: string;
  /** Human-readable period label, e.g. "Mar-Apr" / "מרץ-אפריל". */
  periodLabel: string;
  /** Active locale for currency formatting. */
  locale: string;
};

function severityClass(days: number): string {
  if (days <= 7) return "border-red-500/40 bg-red-500/10";
  if (days <= 14) return "border-amber-400/40 bg-amber-500/10";
  return "border-emerald-400/30 bg-emerald-500/5";
}

function formatCurrency(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₪${Math.round(value).toLocaleString("en-US")}`;
  }
}

export default function VatDueCard({
  amountMajor,
  daysUntilDue,
  dueDateIso,
  periodLabel,
  locale,
}: Props) {
  const t = useTranslations("app.dashboard.tiles.vatDue");
  const tone = severityClass(daysUntilDue);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={`relative flex flex-col gap-2 rounded-2xl border p-5 ${tone}`}
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Receipt size={13} className="text-emerald-300" />
          {t("label")}
        </span>
        <span className="rounded-full bg-slate-950/40 px-2 py-0.5 text-[10px] text-slate-300">
          {periodLabel}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="text-3xl font-semibold tracking-tight text-slate-50"
          dir="ltr"
        >
          {formatCurrency(amountMajor, locale)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
        <Calendar size={12} />
        <span>
          {daysUntilDue >= 0
            ? t("daysLeft", { days: daysUntilDue, due: dueDateIso })
            : t("daysOverdue", { days: Math.abs(daysUntilDue), due: dueDateIso })}
        </span>
      </div>
    </motion.article>
  );
}
