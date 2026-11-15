"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SelectField } from "@/components/app/ui/Field";

export type LedgerBusinessOption = {
  id: string;
  legalName: string;
  bookkeepingMethod: string;
};

export type JournalEntrySummary = {
  id: string;
  entryDate: string;
  description: string | null;
  source: string;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
};

type Props = {
  entries: JournalEntrySummary[];
  businesses: ReadonlyArray<LedgerBusinessOption>;
  initialBusinessId: string;
};

function minorToDisplay(amountMinor: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  return `${sign}${major.toString()}.${cents.toString().padStart(2, "0")}`;
}

export default function LedgerView({
  entries,
  businesses,
  initialBusinessId,
}: Props) {
  const t = useTranslations("app.ledger");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessId, setBusinessId] = useState(
    initialBusinessId || (businesses[0]?.id ?? ""),
  );

  function applyBusinessFilter(v: string) {
    setBusinessId(v);
    startTransition(() => {
      const qs = new URLSearchParams();
      if (v) qs.set("businessId", v);
      router.push(qs.toString() ? `/ledger?${qs.toString()}` : "/ledger");
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
        <SelectField
          label={t("filterBusiness")}
          name="businessId"
          value={businessId}
          onChange={applyBusinessFilter}
          options={businesses.map((b) => ({
            value: b.id,
            label: b.legalName,
          }))}
          disabled={pending}
        />
      </motion.div>

      {entries.length === 0 ? (
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
                <th className="px-4 py-3 text-start">{t("col.source")}</th>
                <th className="px-4 py-3 text-start">{t("col.description")}</th>
                <th className="px-4 py-3 text-start">{t("col.lines")}</th>
                <th className="px-4 py-3 text-end">{t("col.debit")}</th>
                <th className="px-4 py-3 text-end">{t("col.credit")}</th>
                <th className="px-4 py-3 text-end">{t("col.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const balanced =
                  BigInt(e.totalDebit) === BigInt(e.totalCredit);
                return (
                  <tr
                    key={e.id}
                    className="glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
                  >
                    <td className="px-4 py-3 text-slate-300" dir="ltr">
                      {e.entryDate}
                    </td>
                    <td className="px-4 py-3 text-slate-300" dir="ltr">
                      {e.source}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {e.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400" dir="ltr">
                      {e.lineCount}
                    </td>
                    <td className="px-4 py-3 text-end text-slate-200" dir="ltr">
                      {minorToDisplay(e.totalDebit)}
                    </td>
                    <td className="px-4 py-3 text-end text-slate-200" dir="ltr">
                      {minorToDisplay(e.totalCredit)}
                    </td>
                    <td className="px-4 py-3 text-end" dir="ltr">
                      {balanced ? (
                        <span className="text-emerald-300">
                          {t("balanced")}
                        </span>
                      ) : (
                        <span className="text-red-300">
                          {t("unbalanced")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}
