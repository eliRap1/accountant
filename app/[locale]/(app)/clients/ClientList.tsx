"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Pencil, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type ClientRow = {
  id: string;
  legalName: string;
  vatId: string | null;
  emailCiphertext: string | null;
  phoneCiphertext: string | null;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
  businessId: string;
  businessName: string;
};

type SortKey = "legalName" | "businessName" | "vatId";
type SortDir = "asc" | "desc";

type Props = { rows: ClientRow[] };

export default function ClientList({ rows }: Props) {
  const t = useTranslations("app.clients");
  const [sortKey, setSortKey] = useState<SortKey>("legalName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return sortDir === "asc"
        ? av.localeCompare(bv, undefined, { numeric: true })
        : bv.localeCompare(av, undefined, { numeric: true });
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  if (rows.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong rounded-2xl p-8 text-center"
      >
        <p className="text-sm text-slate-300">{t("emptyState")}</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong overflow-hidden rounded-2xl"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <th
              role="button"
              onClick={() => toggleSort("legalName")}
              className="px-4 py-3 text-start cursor-pointer hover:text-slate-300"
            >
              {t("col.legalName")}
              {sortKey === "legalName" && (sortDir === "asc" ? " ↑" : " ↓")}
            </th>
            <th
              role="button"
              onClick={() => toggleSort("businessName")}
              className="px-4 py-3 text-start cursor-pointer hover:text-slate-300"
            >
              {t("col.business")}
              {sortKey === "businessName" && (sortDir === "asc" ? " ↑" : " ↓")}
            </th>
            <th
              role="button"
              onClick={() => toggleSort("vatId")}
              className="px-4 py-3 text-start cursor-pointer hover:text-slate-300"
            >
              {t("col.vatId")}
              {sortKey === "vatId" && (sortDir === "asc" ? " ↑" : " ↓")}
            </th>
            <th className="px-4 py-3 text-start">{t("col.email")}</th>
            <th className="px-4 py-3 text-start">{t("col.phone")}</th>
            <th className="px-4 py-3 text-end">{t("col.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr
              key={c.id}
              className="glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
            >
              <td className="px-4 py-3 font-medium text-slate-100">
                {c.legalName}
              </td>
              <td className="px-4 py-3 text-slate-300">{c.businessName}</td>
              <td className="px-4 py-3 text-slate-300" dir="ltr">
                {c.vatId ?? "—"}
              </td>
              <td className="px-4 py-3 text-slate-500" dir="ltr">
                {c.emailCiphertext ? (
                  <span title={t("encryptedTooltip")}>
                    {"•••• "}
                    <span className="text-xs text-slate-600">
                      {t("masked")}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-slate-500" dir="ltr">
                {c.phoneCiphertext ? (
                  <span title={t("encryptedTooltip")}>
                    {"•••• "}
                    <span className="text-xs text-slate-600">
                      {t("masked")}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/clients/${c.id}`}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                    aria-label={t("col.view")}
                  >
                    <Eye size={14} />
                  </Link>
                  <Link
                    href={`/clients/${c.id}/edit`}
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
  );
}
