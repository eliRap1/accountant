"use client";

import { motion } from "framer-motion";
import { Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type AuditPackageRow = {
  id: string;
  businessId: string;
  businessName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  totalArtifacts: number;
  fileBlobUrl: string | null;
  fileKeyId: string | null;
};

type Props = { rows: AuditPackageRow[] };

export default function AuditPackageList({ rows }: Props) {
  const t = useTranslations("app.audit");

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
            <th className="px-4 py-3 text-start">{t("col.business")}</th>
            <th className="px-4 py-3 text-start">{t("col.period")}</th>
            <th className="px-4 py-3 text-start">{t("col.generatedAt")}</th>
            <th className="px-4 py-3 text-end">{t("col.artifacts")}</th>
            <th className="px-4 py-3 text-end">{t("col.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              className="glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
            >
              <td className="px-4 py-3 font-medium text-slate-100">
                {p.businessName}
              </td>
              <td className="px-4 py-3 text-slate-300" dir="ltr">
                {p.periodStart} → {p.periodEnd}
              </td>
              <td className="px-4 py-3 text-slate-300" dir="ltr">
                {String(p.generatedAt).slice(0, 19).replace("T", " ")}
              </td>
              <td className="px-4 py-3 text-end text-slate-200">
                {p.totalArtifacts}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/audit/${p.id}` as `/${string}`}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                    aria-label={t("col.view")}
                  >
                    <Eye size={14} />
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
