"use client";

import { useTranslations } from "next-intl";
import { SelectField, type SelectOption } from "@/components/app/ui/Field";

// Bank + source-format picker for the upload page. The two fields are
// linked: choosing "Leumi" preselects "leumi_pdf", choosing "Hapoalim"
// preselects "hapoalim_csv", etc. For the "Other (CSV)" path the user
// keeps the picker open so they can pin a different format.

export const BANK_OPTIONS = [
  { value: "leumi", labelKey: "bank.leumi", defaultFormat: "leumi_pdf" },
  {
    value: "hapoalim",
    labelKey: "bank.hapoalim",
    defaultFormat: "hapoalim_csv",
  },
  { value: "mizrahi", labelKey: "bank.mizrahi", defaultFormat: "mizrahi_xlsx" },
  {
    value: "discount",
    labelKey: "bank.discount",
    defaultFormat: "discount_csv",
  },
  { value: "ofx", labelKey: "bank.ofx", defaultFormat: "ofx" },
  {
    value: "greeninvoice",
    labelKey: "bank.greeninvoice",
    defaultFormat: "greeninvoice_csv",
  },
  { value: "other", labelKey: "bank.other", defaultFormat: "csv" },
] as const;

export const FORMAT_OPTIONS = [
  "leumi_pdf",
  "hapoalim_csv",
  "mizrahi_xlsx",
  "discount_csv",
  "ofx",
  "csv",
  "greeninvoice_csv",
] as const;

export default function BankPicker({
  bank,
  sourceFormat,
  onChangeBank,
  onChangeFormat,
  disabled,
}: {
  bank: string;
  sourceFormat: string;
  onChangeBank: (v: string) => void;
  onChangeFormat: (v: string) => void;
  disabled?: boolean;
}): React.ReactNode {
  const t = useTranslations("app.bankImports");

  const bankOptions: SelectOption[] = BANK_OPTIONS.map((b) => ({
    value: b.value,
    label: t(b.labelKey),
  }));
  const formatOptions: SelectOption[] = FORMAT_OPTIONS.map((f) => ({
    value: f,
    label: t(`format.${f}`),
  }));

  function pickBank(v: string) {
    onChangeBank(v);
    const match = BANK_OPTIONS.find((b) => b.value === v);
    if (match) onChangeFormat(match.defaultFormat);
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SelectField
        label={t("bankLabel")}
        name="bank"
        value={bank}
        onChange={pickBank}
        options={bankOptions}
        disabled={disabled ?? false}
      />
      <SelectField
        label={t("formatLabel")}
        name="sourceFormat"
        value={sourceFormat}
        onChange={onChangeFormat}
        options={formatOptions}
        disabled={disabled ?? false}
      />
    </div>
  );
}
