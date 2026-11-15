"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUpRight, FileText } from "lucide-react";
import { Link } from "@/i18n/navigation";

// Overdue invoices tile — Product council § 3 tile #3. Click-through
// goes to /invoices filtered by overdue (the filter is owned by the
// invoices agent; the link works regardless).

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

export default function OverdueInvoicesCard({
  count,
  totalMajor,
  locale,
}: Props) {
  const t = useTranslations("app.dashboard.tiles.overdueInvoices");
  const hasOverdue = count > 0;
  const Icon = hasOverdue ? AlertTriangle : FileText;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className={`relative flex flex-col gap-2 rounded-2xl border p-5 ${
        hasOverdue
          ? "border-amber-400/40 bg-amber-500/10"
          : "border-white/5 bg-slate-950/50"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
        <Icon
          size={13}
          className={hasOverdue ? "text-amber-300" : "text-emerald-300"}
        />
        {t("label")}
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tracking-tight text-slate-50 tabular-nums">
          {count}
        </span>
        {hasOverdue ? (
          <span className="text-sm text-slate-300" dir="ltr">
            {formatCurrency(totalMajor, locale)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>{hasOverdue ? t("hasOverdue") : t("allClear")}</span>
        {hasOverdue ? (
          <Link
            // The invoices route may not exist at typedRoutes time —
            // cast to bypass until the agent's page lands.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            href={"/invoices" as any}
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
