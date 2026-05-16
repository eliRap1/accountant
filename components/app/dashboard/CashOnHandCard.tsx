"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";

// Cash-on-hand tile — Product council § 3 tile #2. Pairs visually with
// the VAT-due tile above so the user can answer "can I pay it?" in one
// glance. Major units (₪).

type Props = {
  totalMajor: number;
  /** Number of contributing financial accounts. */
  accountCount: number;
  /** Active locale for currency formatting. */
  locale: string;
};

function formatCurrency(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "he-IL" ? "he-IL" : "en-IL", {
      style: "currency",
      currency: "ILS",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₪${Math.round(value).toLocaleString("en-US")}`;
  }
}

export default function CashOnHandCard({
  totalMajor,
  accountCount,
  locale,
}: Props) {
  const t = useTranslations("app.dashboard.tiles.cashOnHand");
  const isNegative = totalMajor < 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="relative flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/50 p-5"
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
        <Wallet size={13} className="text-emerald-300" />
        {t("label")}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`text-3xl font-semibold tracking-tight ${
            isNegative ? "text-red-300" : "text-slate-50"
          }`}
          dir="ltr"
        >
          {formatCurrency(totalMajor, locale)}
        </span>
      </div>
      <div className="text-xs text-slate-400">
        {t("accountCount", { count: accountCount })}
      </div>
    </motion.article>
  );
}
