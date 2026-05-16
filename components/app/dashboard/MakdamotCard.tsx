"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Coins } from "lucide-react";
import { Link } from "@/i18n/navigation";

// מקדמות paid vs due tile — Product council § 3 tile #5. When the Layer 3
// `tax_advances` table isn't migrated locally, we render the "preview"
// state so the dashboard never crashes during partial migrations.

type Props =
  | {
      available: false;
      locale: string;
    }
  | {
      available: true;
      dueMajor: number;
      paidMajor: number;
      balanceMajor: number;
      installmentCount: number;
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

export default function MakdamotCard(props: Props) {
  const t = useTranslations("app.dashboard.tiles.makdamot");

  if (!props.available) {
    return (
      <motion.article
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="relative flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-950/50 p-5"
      >
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-slate-400">
          <Coins size={13} className="text-emerald-300" />
          {t("label")}
        </div>
        <div className="mt-1 text-sm text-slate-300">{t("notAvailable")}</div>
        <div className="text-xs text-slate-500">{t("notAvailableHint")}</div>
      </motion.article>
    );
  }

  const { paidMajor, dueMajor, balanceMajor, installmentCount, locale } = props;
  const isUnderpaid = balanceMajor > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className={`relative flex flex-col gap-2 rounded-2xl border p-5 ${
        isUnderpaid
          ? "border-amber-400/40 bg-amber-500/10"
          : "border-white/5 bg-slate-950/50"
      }`}
    >
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Coins size={13} className="text-emerald-300" />
          {t("label")}
        </span>
        <span className="rounded-full bg-slate-950/40 px-2 py-0.5 text-[10px] text-slate-300">
          {t("installments", { count: installmentCount })}
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2 text-slate-50">
          <span className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("paid")}
          </span>
          <span className="text-xl font-semibold tabular-nums" dir="ltr">
            {formatCurrency(paidMajor, locale)}
          </span>
        </div>
        <div className="flex items-baseline gap-2 text-slate-300">
          <span className="text-[11px] uppercase tracking-wider text-slate-500">
            {t("due")}
          </span>
          <span className="text-sm tabular-nums" dir="ltr">
            {formatCurrency(dueMajor, locale)}
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span>
          {isUnderpaid
            ? t("balanceOwed", { amount: formatCurrency(balanceMajor, locale) })
            : t("upToDate")}
        </span>
        <Link
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          href={"/tax/makdamot" as any}
          className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
        >
          {t("cta")}
          <ArrowUpRight size={11} />
        </Link>
      </div>
    </motion.article>
  );
}
