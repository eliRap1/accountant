"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

// Inline banner for the review table when a parsed row's fingerprint
// matches an existing transaction.
//
// We don't show this on the upload page — the SQL probe runs server-
// side inside ParseReview's loader. The banner is a pure-presentation
// component the row template instantiates.

export default function DedupBanner({
  duplicateOf,
}: {
  duplicateOf: { txnDate: string; description: string | null } | null;
}): React.ReactNode {
  const t = useTranslations("app.bankImports");
  if (!duplicateOf) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
      <AlertTriangle size={12} className="mt-[2px] flex-shrink-0" />
      <span>
        {t("dedup.candidateOf", {
          date: duplicateOf.txnDate,
          desc: duplicateOf.description?.slice(0, 40) ?? "—",
        })}
      </span>
    </div>
  );
}
