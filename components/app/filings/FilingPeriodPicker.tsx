"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Field } from "@/components/app/ui/Field";

// Period picker — toggles between a date-range (PCN874 / form_102) and a
// single fiscal-year input (form_6111 / 1301 / 1214 / 126 / 856).
//
// Both shapes ultimately emit a (periodStart, periodEnd) ISO date pair —
// for the fiscal-year mode we synthesize Jan-1 / Dec-31 of the chosen
// year so the server-side schema accepts a single shape.

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
  periodStart: string; // ISO YYYY-MM-DD
  periodEnd: string;   // ISO YYYY-MM-DD
  onChangeStart: (v: string) => void;
  onChangeEnd: (v: string) => void;
  disabled?: boolean;
};

function isFiscalYearKind(kind: FilingKind): boolean {
  return (
    kind === "form_6111" ||
    kind === "form_1301" ||
    kind === "form_1214" ||
    kind === "form_126" ||
    kind === "form_856"
  );
}

export default function FilingPeriodPicker({
  kind,
  periodStart,
  periodEnd,
  onChangeStart,
  onChangeEnd,
  disabled,
}: Props): ReactNode {
  const t = useTranslations("app.filings.wizard");
  const fiscalYearMode = isFiscalYearKind(kind);

  if (fiscalYearMode) {
    const year = periodStart.slice(0, 4) || new Date().getUTCFullYear().toString();
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("fiscalYearLabel")}
          name="fiscalYear"
          type="number"
          dir="ltr"
          value={year}
          onChange={(v) => {
            const sanitised = v.replace(/[^0-9]/g, "").slice(0, 4);
            if (sanitised.length === 4) {
              onChangeStart(`${sanitised}-01-01`);
              onChangeEnd(`${sanitised}-12-31`);
            } else {
              onChangeStart(`${sanitised || ""}-01-01`);
              onChangeEnd(`${sanitised || ""}-12-31`);
            }
          }}
          min={2000}
          max={2099}
          inputMode="numeric"
          help={t("fiscalYearHelp")}
          disabled={disabled ?? false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("periodStartLabel")}
          name="periodStart"
          type="date"
          dir="ltr"
          value={periodStart}
          onChange={onChangeStart}
          disabled={disabled ?? false}
        />
        <Field
          label={t("periodEndLabel")}
          name="periodEnd"
          type="date"
          dir="ltr"
          value={periodEnd}
          onChange={onChangeEnd}
          disabled={disabled ?? false}
        />
      </div>
      <p className="text-[11px] text-slate-500">{t("periodHelp")}</p>
    </div>
  );
}
