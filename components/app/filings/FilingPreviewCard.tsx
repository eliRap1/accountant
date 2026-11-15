"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

// Preview card shown at the wizard's "review totals" step.
//
// Renders three numbers (invoice count, pre-VAT sum, VAT sum) for the
// PCN874 case, or a fiscal-year banner + the "layer not built" note for
// the other forms.
//
// The numbers are minor-unit strings (bigint serialised to text); we
// format them client-side with Intl.NumberFormat for locale-aware
// rendering. The currency is hard-coded to ILS because the IL ITA does
// not currently accept other currencies on these forms.

export type FilingKind =
  | "pcn874"
  | "form_6111"
  | "form_102"
  | "form_1301"
  | "form_1214"
  | "form_126"
  | "form_856";

type Props = {
  kind: FilingKind;
  invoiceCount?: number;
  sumPreVatMinor?: string;
  sumVatMinor?: string;
  fiscalYear?: number;
};

function minorToDisplay(amountMinor: string): string {
  try {
    const v = BigInt(amountMinor);
    const sign = v < 0n ? "-" : "";
    const abs = v < 0n ? -v : v;
    const major = abs / 100n;
    const cents = abs % 100n;
    const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}₪${majorStr}.${cents.toString().padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

export default function FilingPreviewCard({
  kind,
  invoiceCount,
  sumPreVatMinor,
  sumVatMinor,
  fiscalYear,
}: Props): ReactNode {
  const t = useTranslations("app.filings.wizard");
  const isPcn = kind === "pcn874";

  if (isPcn) {
    return (
      <section className="glass-strong rounded-2xl p-5">
        <h3 className="text-sm font-medium tracking-tight text-slate-200">
          {t("previewTitle")}
        </h3>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PreviewRow label={t("previewInvoiceCount")}>
            <span dir="ltr" className="text-lg font-semibold text-slate-50">
              {typeof invoiceCount === "number" ? invoiceCount : "—"}
            </span>
          </PreviewRow>
          <PreviewRow label={t("previewSumPreVat")}>
            <span dir="ltr" className="text-lg font-semibold text-slate-50">
              {sumPreVatMinor ? minorToDisplay(sumPreVatMinor) : "—"}
            </span>
          </PreviewRow>
          <PreviewRow label={t("previewSumVat")}>
            <span dir="ltr" className="text-lg font-semibold text-emerald-200">
              {sumVatMinor ? minorToDisplay(sumVatMinor) : "—"}
            </span>
          </PreviewRow>
        </dl>
      </section>
    );
  }

  return (
    <section className="glass-strong rounded-2xl p-5">
      <h3 className="text-sm font-medium tracking-tight text-slate-200">
        {t("previewTitle")}
      </h3>
      {typeof fiscalYear === "number" ? (
        <p className="mt-2 text-sm text-slate-300">
          <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {t("previewFiscalYear")}:
          </span>{" "}
          <span dir="ltr" className="text-slate-100">
            {fiscalYear}
          </span>
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">{t("previewLayerNote")}</p>
    </section>
  );
}

function PreviewRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
