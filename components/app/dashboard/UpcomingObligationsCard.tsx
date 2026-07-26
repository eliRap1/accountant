"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CalendarClock, FileArchive, FileText, Landmark, Receipt } from "lucide-react";
import type {
  UpcomingObligations,
  ObligationKind,
} from "@/lib/aggregations/upcomingObligations";

const ICON_FOR_KIND: Record<ObligationKind, typeof CalendarClock> = {
  vat_period_close: CalendarClock,
  bituach_leumi: Landmark,
  makdamot: Landmark,
  filing: FileArchive,
  invoice: FileText,
};

const TINT_FOR_KIND: Record<ObligationKind, string> = {
  vat_period_close: "text-emerald-300",
  bituach_leumi: "text-sky-300",
  makdamot: "text-amber-300",
  filing: "text-violet-300",
  invoice: "text-pink-300",
};

function daysBetween(nowIso: string, dueIso: string): number {
  const a = new Date(nowIso + "T00:00:00Z").getTime();
  const b = new Date(dueIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

export default function UpcomingObligationsCard({
  data,
  nowIso,
  locale,
}: {
  data: UpcomingObligations;
  nowIso: string;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.upcomingObligations");
  const visible = data.items.slice(0, 8);
  const isEmpty = visible.length === 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5 sm:col-span-2"
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
        <Receipt size={16} className="shrink-0 text-emerald-300" />
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const Icon = ICON_FOR_KIND[item.kind];
            const tint = TINT_FOR_KIND[item.kind];
            const delta = daysBetween(nowIso, item.dueDateIso);
            const deltaLabel =
              delta < 0
                ? t("overdue")
                : delta === 0
                  ? t("today")
                  : t("daysUntil", { days: delta });
            const amount =
              item.amountMajor != null
                ? new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: item.currency ?? "ILS",
                    maximumFractionDigits: 0,
                  }).format(item.amountMajor)
                : null;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2"
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon size={16} className={`shrink-0 ${tint}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {item.label}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      {t(`kind.${item.kind}`)} · {deltaLabel}
                    </p>
                  </div>
                </div>
                {amount && (
                  <p className="text-end text-sm text-slate-200" dir="ltr">
                    {amount}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.article>
  );
}
