"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

// Estimates-only disclaimer banner. Required on every tax / filing /
// AI surface from Phase D onwards (Plan v4 § Locked Decisions).
//
// Two variants:
//   - "banner": full inline banner with icon + bilingual stacked text,
//     suitable for the top of a tax route or a wizard step.
//   - "footer": compact single-line variant for embedding in the
//     bottom of a page or PDF preview.
//
// Both variants render BOTH Hebrew + English copy unconditionally,
// regardless of the active UI locale. The reason is regulatory:
//   * IL Tax Authority + PPA expect the disclaimer in Hebrew.
//   * Diaspora users + auditors expect the English one.
// Rendering both also means `scripts/lint-legal-text.ts` always
// matches HE_DISCLAIMER ("אומדנים בלבד · אינו ייעוץ מס") and
// EN_DISCLAIMER ("Estimates only") on any page importing this.
//
// The Hebrew + English strings are pulled from
// `app.legal.disclaimer.{banner,footer}` keys in he-IL.json + en-US.json
// — but we also render the canonical English literal verbatim so the
// disclaimer survives even if a user lands on a Russian-rewritten
// route (Plan v4 Risk #24).
//
// Screen-reader long-form lives in `app.legal.disclaimer.{bannerSr,
// footerSr}` so the bilingual stack doesn't get read twice in a
// confusing order by AT — the SR-only string is the canonical
// single-language sentence in the active locale.

export type EstimatesDisclaimerProps = {
  variant?: "banner" | "footer";
  className?: string;
};

// Canonical literals — match the strings the legal-text linter
// expects. Keep these in sync with the HE_DISCLAIMER + EN_DISCLAIMER
// constants in `scripts/lint-legal-text.ts`.
const HE_BANNER = "אומדנים בלבד · אינו ייעוץ מס · התייעצו עם רואה חשבון מורשה";
const EN_BANNER = "Estimates only · Not tax advice · Consult a licensed accountant";

export default function EstimatesDisclaimer({
  variant = "banner",
  className = "",
}: EstimatesDisclaimerProps) {
  const t = useTranslations("app.legal.disclaimer");

  if (variant === "footer") {
    return (
      <p
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-emerald-500/15 pt-3 text-[11px] leading-relaxed text-slate-400 ${className}`}
        role="note"
      >
        <Info className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
        <span className="sr-only">{t("footerSr")}</span>
        <span dir="rtl" lang="he">
          {HE_BANNER}
        </span>
        <span className="text-slate-600" aria-hidden>
          ·
        </span>
        <span dir="ltr" lang="en">
          {EN_BANNER}
        </span>
      </p>
    );
  }

  return (
    <aside
      className={`flex flex-col gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm leading-relaxed text-slate-200 sm:flex-row sm:items-center sm:gap-3 ${className}`}
      role="note"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Info className="h-4 w-4" aria-hidden />
      </span>
      <span className="sr-only">{t("bannerSr")}</span>
      <div className="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span dir="rtl" lang="he" className="text-slate-200">
          {HE_BANNER}
        </span>
        <span dir="ltr" lang="en" className="text-slate-400">
          {EN_BANNER}
        </span>
      </div>
    </aside>
  );
}
