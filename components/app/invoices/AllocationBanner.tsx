"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ShieldCheck, Info } from "lucide-react";
import { Field } from "@/components/app/ui/Field";

// Visual surface for the חשבונית ישראל allocation-number flow.
//
// Threshold is derived server-side by lib/invoices/allocationThreshold.ts
// at issue time AND mirrored client-side here so the operator gets a
// live banner as they type the amount. The lib's threshold table is
// the single source of truth — if it drifts we update both places.
//
// State logic:
//   - `vatStatus === "osek_patur"` → exempt; show ShieldCheck "no
//     allocation needed".
//   - `totalMinor > threshold` → required; show AlertTriangle with a
//     text field for pasting the SHAAM allocation number manually.
//   - `totalMinor` within 10% of threshold → warn (Info) the operator
//     that they're close to the cap.

export type AllocationBannerProps = {
  totalMinor: bigint;
  thresholdMinor: bigint;
  vatStatus: string;
  currency: string;
  allocationNumber: string;
  onAllocationNumberChange: (v: string) => void;
  disabled?: boolean;
};

function formatMinor(minor: bigint, currency: string): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const major = abs / 100n;
  const cents = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${majorStr}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default function AllocationBanner(
  props: AllocationBannerProps,
): React.ReactNode {
  const {
    totalMinor,
    thresholdMinor,
    vatStatus,
    currency,
    allocationNumber,
    onAllocationNumberChange,
    disabled,
  } = props;
  const t = useTranslations("app.invoices.allocation");

  if (vatStatus === "osek_patur") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
        <ShieldCheck size={14} />
        <span>{t("paturExempt")}</span>
      </div>
    );
  }

  const required = totalMinor > thresholdMinor;
  // Soft warn band: within 10% of the threshold from below.
  const warnFloor = (thresholdMinor * 9n) / 10n;
  const near = !required && totalMinor >= warnFloor;

  if (required) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-3">
        <div className="flex items-start gap-2 text-sm text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="font-medium">{t("requiredHeading")}</p>
            <p className="text-xs text-amber-200/90">
              {t("requiredBody", {
                threshold: formatMinor(thresholdMinor, currency),
              })}
            </p>
          </div>
        </div>
        <Field
          label={t("allocationNumberLabel")}
          name="allocationNumber"
          dir="ltr"
          value={allocationNumber}
          onChange={onAllocationNumberChange}
          placeholder={t("allocationNumberPlaceholder")}
          help={t("allocationNumberHelp")}
          {...(disabled !== undefined ? { disabled } : {})}
        />
      </div>
    );
  }

  if (near) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">{t("nearHeading")}</p>
          <p className="text-xs text-sky-200/80">
            {t("nearBody", {
              threshold: formatMinor(thresholdMinor, currency),
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
      <Info size={12} />
      <span>
        {t("belowThreshold", {
          threshold: formatMinor(thresholdMinor, currency),
        })}
      </span>
    </div>
  );
}
