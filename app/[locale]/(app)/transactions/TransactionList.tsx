"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Repeat, Eye, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { SelectField, Field } from "@/components/app/ui/Field";

export type TransactionRow = {
  id: string;
  businessId: string;
  businessName: string;
  direction: "income" | "expense" | "transfer";
  amountMinor: string;
  currency: string;
  categoryCode: string | null;
  categoryName: string | null;
  description: string | null;
  txnDate: string;
  source: string;
  accountName: string | null;
};

type Props = {
  rows: TransactionRow[];
  businesses: ReadonlyArray<{ id: string; legalName: string }>;
  initialBusinessId: string;
  initialFrom: string;
  initialTo: string;
};

function minorToDisplay(amountMinor: string, currency: string): string {
  // Parse as bigint to keep precision; divide by 100 in display.
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  const formatted = `${sign}${major.toString()}.${cents.toString().padStart(2, "0")}`;
  return `${formatted} ${currency}`;
}

export default function TransactionList({
  rows,
  businesses,
  initialBusinessId,
  initialFrom,
  initialTo,
}: Props) {
  const t = useTranslations("app.transactions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessId, setBusinessId] = useState(initialBusinessId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  function applyFilters() {
    const qs = new URLSearchParams();
    if (businessId) qs.set("businessId", businessId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString();
    startTransition(() => {
      router.push(
        // Empty -> root path
        suffix ? `/transactions?${suffix}` : "/transactions",
      );
    });
  }

  function clearFilters() {
    setBusinessId("");
    setFrom("");
    setTo("");
    startTransition(() => {
      router.push("/transactions");
    });
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="glass rounded-2xl p-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <SelectField
            label={t("filterBusiness")}
            name="businessIdFilter"
            value={businessId}
            onChange={setBusinessId}
            options={[
              { value: "", label: t("filterAllBusinesses") },
              ...businesses.map((b) => ({ value: b.id, label: b.legalName })),
            ]}
            disabled={pending}
          />
          <Field
            label={t("filterFrom")}
            name="from"
            type="date"
            dir="ltr"
            value={from}
            onChange={setFrom}
            disabled={pending}
          />
          <Field
            label={t("filterTo")}
            name="to"
            type="date"
            dir="ltr"
            value={to}
            onChange={setTo}
            disabled={pending}
          />
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              disabled={pending}
              className="flex-1 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
            >
              {t("filterApply")}
            </button>
            <button
              type="button"
              onClick={clearFilters}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:border-white/20 disabled:opacity-60"
            >
              {t("filterClear")}
            </button>
          </div>
        </div>
      </motion.div>

      {rows.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="glass-strong rounded-2xl p-8 text-center"
        >
          <p className="text-sm text-slate-300">{t("emptyState")}</p>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="glass-strong overflow-hidden rounded-2xl"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3 text-start">{t("col.date")}</th>
                <th className="px-4 py-3 text-start">{t("col.direction")}</th>
                <th className="px-4 py-3 text-start">{t("col.amount")}</th>
                <th className="px-4 py-3 text-start">{t("col.business")}</th>
                <th className="px-4 py-3 text-start">{t("col.account")}</th>
                <th className="px-4 py-3 text-start">{t("col.category")}</th>
                <th className="px-4 py-3 text-start">{t("col.description")}</th>
                <th className="px-4 py-3 text-end">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
                >
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.txnDate}
                  </td>
                  <td className="px-4 py-3">
                    <DirectionBadge direction={r.direction} t={t} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-100" dir="ltr">
                    {minorToDisplay(r.amountMinor, r.currency)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.businessName}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {r.accountName ?? t("accountUnallocated")}
                  </td>
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.categoryCode ? (
                      <span>
                        {r.categoryCode}
                        {r.categoryName ? (
                          <span className="ms-1 text-slate-500">
                            · {r.categoryName}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[20ch] truncate">
                    {r.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/transactions/${r.id}`}
                        className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                        aria-label={t("col.view")}
                      >
                        <Eye size={14} />
                      </Link>
                      <Link
                        href={`/transactions/${r.id}/edit`}
                        className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                        aria-label={t("col.edit")}
                      >
                        <Pencil size={14} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}

function DirectionBadge({
  direction,
  t,
}: {
  direction: "income" | "expense" | "transfer";
  t: (k: string) => string;
}) {
  const config = {
    income: {
      icon: ArrowUpRight,
      cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    },
    expense: {
      icon: ArrowDownRight,
      cls: "border-red-400/40 bg-red-500/10 text-red-200",
    },
    transfer: {
      icon: Repeat,
      cls: "border-sky-400/40 bg-sky-500/10 text-sky-200",
    },
  } as const;
  const Pick = config[direction];
  const Icon = Pick.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] ${Pick.cls}`}
    >
      <Icon size={12} />
      {t(`directionOption.${direction}`)}
    </span>
  );
}
