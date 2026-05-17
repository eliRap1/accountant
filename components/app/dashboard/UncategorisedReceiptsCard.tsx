"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Inbox, Receipt } from "lucide-react";
import { Link } from "@/i18n/navigation";

// Uncategorised receipts tile — Product council § 3 tile #4. Number-badge
// style: the count is the hero number, the total ₪ is secondary. CTA
// jumps to /receipts so the user can categorise without leaving the flow.

type Props = {
  count: number;
  totalMajor: number;
  locale: string;
};

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

export default function UncategorisedReceiptsCard({
  count,
  totalMajor,
  locale,
}: Props) {
  const t = useTranslations("app.dashboard.tiles.uncategorisedReceipts");
  const hasItems = count > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="relative flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/50 p-5"
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
        {hasItems ? (
          <Inbox size={13} className="text-emerald-300" />
        ) : (
          <Receipt size={13} className="text-emerald-300" />
        )}
        {t("label")}
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tracking-tight text-slate-50 tabular-nums">
          {count}
        </span>
        {hasItems ? (
          <span className="text-sm text-slate-300" dir="ltr">
            {formatCurrency(totalMajor, locale)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>{hasItems ? t("pending") : t("allCategorised")}</span>
        {hasItems ? (
          <Link
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            href={"/receipts" as any}
            className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
          >
            {t("cta")}
            <ArrowUpRight size={11} />
          </Link>
        ) : null}
      </div>
    </motion.article>
  );
}
