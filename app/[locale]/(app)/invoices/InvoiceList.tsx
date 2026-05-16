"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { Eye, FileDown, Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { SelectField, Field } from "@/components/app/ui/Field";

export type InvoiceRow = {
  id: string;
  businessId: string;
  businessName: string;
  invoiceType:
    | "tax_invoice"
    | "tax_invoice_receipt"
    | "receipt"
    | "credit_note"
    | "proforma"
    | "debit_note"
    | "self_invoice";
  sequentialNumber: number;
  issueDate: string;
  totalMinor: string;
  currencyAtIssue: string;
  allocationStatus:
    | "not_required"
    | "required_not_assigned"
    | "manual_pasted"
    | "partner_issued"
    | "processor_synced"
    | "direct_shaam";
  cancelledAt: string | null;
  clientName: string | null;
};

type Props = {
  rows: InvoiceRow[];
  businesses: ReadonlyArray<{ id: string; legalName: string }>;
  initialBusinessId: string;
  initialFrom: string;
  initialTo: string;
  initialAllocation: string;
};

function minorToDisplay(amountMinor: string, currency: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${majorStr}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default function InvoiceList({
  rows,
  businesses,
  initialBusinessId,
  initialFrom,
  initialTo,
  initialAllocation,
}: Props): React.ReactNode {
  const t = useTranslations("app.invoices");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessId, setBusinessId] = useState(initialBusinessId);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [allocation, setAllocation] = useState(initialAllocation);

  function applyFilters() {
    const qs = new URLSearchParams();
    if (businessId) qs.set("businessId", businessId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (allocation) qs.set("allocation", allocation);
    const suffix = qs.toString();
    startTransition(() => {
      router.push(suffix ? `/invoices?${suffix}` : "/invoices");
    });
  }

  function clearFilters() {
    setBusinessId("");
    setFrom("");
    setTo("");
    setAllocation("");
    startTransition(() => {
      router.push("/invoices");
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
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
          <SelectField
            label={t("filterAllocation")}
            name="allocationFilter"
            value={allocation}
            onChange={setAllocation}
            options={[
              { value: "", label: t("filterAllStatuses") },
              { value: "not_required", label: t("allocationStatus.not_required") },
              {
                value: "required_not_assigned",
                label: t("allocationStatus.required_not_assigned"),
              },
              { value: "manual_pasted", label: t("allocationStatus.manual_pasted") },
              { value: "partner_issued", label: t("allocationStatus.partner_issued") },
              {
                value: "processor_synced",
                label: t("allocationStatus.processor_synced"),
              },
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
                <th className="px-4 py-3 text-start">{t("col.number")}</th>
                <th className="px-4 py-3 text-start">{t("col.date")}</th>
                <th className="px-4 py-3 text-start">{t("col.type")}</th>
                <th className="px-4 py-3 text-start">{t("col.business")}</th>
                <th className="px-4 py-3 text-start">{t("col.client")}</th>
                <th className="px-4 py-3 text-start">{t("col.allocation")}</th>
                <th className="px-4 py-3 text-end">{t("col.total")}</th>
                <th className="px-4 py-3 text-end">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5 ${
                    r.cancelledAt ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-slate-100 font-medium" dir="ltr">
                    #{r.sequentialNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.issueDate}
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={r.invoiceType} cancelled={!!r.cancelledAt} t={t} />
                  </td>
                  <td className="px-4 py-3 text-slate-300">{r.businessName}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {r.clientName ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <AllocationBadge status={r.allocationStatus} t={t} />
                  </td>
                  <td className="px-4 py-3 text-end font-medium text-slate-100" dir="ltr">
                    {minorToDisplay(r.totalMinor, r.currencyAtIssue)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/invoices/${r.id}`}
                        className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                        aria-label={t("col.view")}
                      >
                        <Eye size={14} />
                      </Link>
                      <a
                        href={`/invoices/${r.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                        aria-label={t("col.pdf")}
                      >
                        <FileDown size={14} />
                      </a>
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

function TypeBadge({
  type,
  cancelled,
  t,
}: {
  type: InvoiceRow["invoiceType"];
  cancelled: boolean;
  t: (k: string) => string;
}) {
  const config: Record<
    InvoiceRow["invoiceType"],
    string
  > = {
    tax_invoice: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    tax_invoice_receipt:
      "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    receipt: "border-sky-400/40 bg-sky-500/10 text-sky-200",
    credit_note: "border-red-400/40 bg-red-500/10 text-red-200",
    proforma: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    debit_note: "border-purple-400/40 bg-purple-500/10 text-purple-200",
    self_invoice: "border-slate-400/40 bg-slate-500/10 text-slate-200",
  };
  const cls = config[type];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] ${cls}`}
      >
        {t(`types.option.${type}.he`)}
      </span>
      {cancelled ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-red-200">
          <Ban size={10} />
          {t("cancelledBadge")}
        </span>
      ) : null}
    </span>
  );
}

function AllocationBadge({
  status,
  t,
}: {
  status: InvoiceRow["allocationStatus"];
  t: (k: string) => string;
}) {
  const config: Record<InvoiceRow["allocationStatus"], string> = {
    not_required: "border-white/10 bg-slate-950/40 text-slate-400",
    required_not_assigned:
      "border-amber-400/40 bg-amber-500/10 text-amber-200",
    manual_pasted: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    partner_issued: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    processor_synced:
      "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
    direct_shaam: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${config[status]}`}
    >
      {t(`allocationStatus.${status}`)}
    </span>
  );
}
