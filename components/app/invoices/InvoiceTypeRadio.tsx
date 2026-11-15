"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

// 7 IL invoice types per the schema's invoiceTypeEnum. We render them as
// large radio cards so the bilingual (HE+EN) name + short description
// are always visible — operator picks the right document type before
// adding line items.
export const INVOICE_TYPES = [
  "tax_invoice",
  "tax_invoice_receipt",
  "receipt",
  "credit_note",
  "proforma",
  "debit_note",
  "self_invoice",
] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

type Props = {
  value: InvoiceType;
  onChange: (v: InvoiceType) => void;
  disabled?: boolean;
  /**
   * Hide the credit-note option from the picker. Credit notes are emitted
   * from the parent invoice's cancel action only, never created standalone
   * here — keeping them off the radio prevents the operator from issuing
   * an orphan credit note.
   */
  hideCreditNote?: boolean;
};

export default function InvoiceTypeRadio({
  value,
  onChange,
  disabled,
  hideCreditNote,
}: Props): React.ReactNode {
  const t = useTranslations("app.invoices.types");
  const id = useId();
  const visible = hideCreditNote
    ? INVOICE_TYPES.filter((it) => it !== "credit_note")
    : INVOICE_TYPES;

  return (
    <fieldset
      className="space-y-2"
      aria-labelledby={`${id}-legend`}
      disabled={disabled}
    >
      <legend id={`${id}-legend`} className="block text-sm text-slate-300">
        {t("legend")}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((it) => {
          const selected = value === it;
          return (
            <label
              key={it}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-start transition-colors ${
                selected
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100 ring-1 ring-emerald-400/40"
                  : "border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20"
              } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="invoiceType"
                value={it}
                checked={selected}
                disabled={disabled ?? false}
                onChange={() => onChange(it)}
                className="sr-only"
              />
              <span className="text-sm font-medium tracking-tight">
                {t(`option.${it}.he`)}
              </span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {t(`option.${it}.en`)}
              </span>
              <span className="mt-1 text-xs text-slate-400">
                {t(`option.${it}.desc`)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
