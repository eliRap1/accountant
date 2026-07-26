"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Eye, Lock, FileDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type FilingKind =
  | "pcn874"
  | "form_6111"
  | "form_102"
  | "form_1301"
  | "form_1214"
  | "form_126"
  | "form_856";

export type FilingStatus =
  | "draft"
  | "generated"
  | "downloaded"
  | "submitted";

export type FilingRow = {
  id: string;
  businessId: string;
  businessName: string;
  kind: FilingKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  status: FilingStatus;
  submittedAt: string | null;
  submittedAsmachta: string | null;
  fileMime: string | null;
};

type Props = {
  rows: ReadonlyArray<FilingRow>;
  canPcn: boolean;
  canForms: boolean;
};

const KIND_ORDER: FilingKind[] = [
  "pcn874",
  "form_6111",
  "form_102",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
];

export default function FilingList({
  rows,
  canPcn,
  canForms,
}: Props): React.ReactNode {
  const t = useTranslations("app.filings");

  const grouped = useMemo(() => {
    const map = new Map<FilingKind, FilingRow[]>();
    for (const kind of KIND_ORDER) map.set(kind, []);
    for (const row of rows) {
      const list = map.get(row.kind) ?? [];
      list.push(row);
      map.set(row.kind, list);
    }
    return map;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong rounded-2xl p-8 text-center"
      >
        <p className="text-sm text-slate-300">{t("emptyState")}</p>
        <PlanHint canPcn={canPcn} canForms={canForms} />
      </motion.div>
    );
  }

  return (
    <div className="space-y-8">
      {KIND_ORDER.map((kind) => {
        const list = grouped.get(kind) ?? [];
        if (list.length === 0) return null;
        const locked = kind === "pcn874" ? !canPcn : !canForms;

        return (
          <section key={kind} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">
                {t(`groupHeading.${kind}`)}
              </h2>
              {locked ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-200">
                  <Lock size={10} />
                  {t("kindLockedDesc", {
                    plan: kind === "pcn874" ? t("planName.solo") : t("planName.plus"),
                  })}
                </span>
              ) : null}
            </div>

            <div className="glass-strong overflow-hidden rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-4 py-3 text-start">{t("col.period")}</th>
                    <th className="px-4 py-3 text-start">{t("col.generatedAt")}</th>
                    <th className="px-4 py-3 text-start">{t("col.status")}</th>
                    <th className="px-4 py-3 text-start">{t("col.asmachta")}</th>
                    <th className="px-4 py-3 text-end">{t("col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
                    >
                      <td className="px-4 py-3 text-slate-200" dir="ltr">
                        {r.periodStart} → {r.periodEnd}
                      </td>
                      <td className="px-4 py-3 text-slate-400" dir="ltr">
                        {r.generatedAt.slice(0, 10)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} t={t} />
                      </td>
                      <td className="px-4 py-3 text-slate-300" dir="ltr">
                        {r.submittedAsmachta ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/filings/${r.id}`}
                            className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                            aria-label={t("col.view")}
                          >
                            <Eye size={14} />
                          </Link>
                          <a
                            href={`/api/filings/${r.id}/download`}
                            className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                            aria-label={t("detail.downloadCta")}
                          >
                            <FileDown size={14} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: FilingStatus;
  t: (k: string) => string;
}) {
  const config: Record<FilingStatus, string> = {
    draft: "border-white/10 bg-slate-950/40 text-slate-400",
    generated: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    downloaded: "border-sky-400/40 bg-sky-500/10 text-sky-200",
    submitted: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${config[status]}`}
    >
      {t(`statusBadge.${status}`)}
    </span>
  );
}

function PlanHint({
  canPcn,
  canForms,
}: {
  canPcn: boolean;
  canForms: boolean;
}) {
  const t = useTranslations("app.filings");
  if (canPcn && canForms) return null;
  return (
    <p className="mt-2 text-xs text-slate-500">
      {!canPcn
        ? t("kindLockedDesc", { plan: t("planName.solo") })
        : t("kindLockedDesc", { plan: t("planName.plus") })}{" "}
      <Link href="/billing" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">
        {t("upgradeCta")}
      </Link>
    </p>
  );
}
