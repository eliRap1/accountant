"use client";

import { useTranslations } from "next-intl";

export type OrphanReceipt = {
  id: string;
  parsedAmountMinor: string;
  parsedDate: string;
  // Stored as plaintext JSON in parsed_vendor_ciphertext for processor_sync.
  // The page decodes it before passing.
  customerLabel: string;
  receiptNumber: string | null;
  matchReason: "no_match" | "ambiguous" | "amount_date" | "exact";
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

export default function UnpairedReceiptsList({
  rows,
}: {
  rows: OrphanReceipt[];
}): React.ReactNode {
  const t = useTranslations("app.processorSync");
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400">{t("orphans.empty")}</p>
    );
  }
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <th className="px-3 py-3 text-start">{t("orphans.col.date")}</th>
            <th className="px-3 py-3 text-end">{t("orphans.col.amount")}</th>
            <th className="px-3 py-3 text-start">{t("orphans.col.customer")}</th>
            <th className="px-3 py-3 text-start">{t("orphans.col.receiptNo")}</th>
            <th className="px-3 py-3 text-start">{t("orphans.col.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-white/5">
              <td className="px-3 py-2 text-slate-300" dir="ltr">
                {r.parsedDate}
              </td>
              <td className="px-3 py-2 text-end text-emerald-200" dir="ltr">
                {minorToDisplay(r.parsedAmountMinor, "ILS")}
              </td>
              <td className="px-3 py-2 text-slate-200">{r.customerLabel}</td>
              <td className="px-3 py-2 text-slate-300" dir="ltr">
                {r.receiptNumber ?? "—"}
              </td>
              <td className="px-3 py-2 text-slate-400">
                {t(`orphans.reason.${r.matchReason}`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
