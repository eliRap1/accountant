"use client";

import { useTranslations } from "next-intl";
import { Clock, AlertTriangle } from "lucide-react";

// Shows the "last synced N hours ago" affordance with a stale colour
// state if the gap exceeds STALE_HOURS or consecutiveFailures > 0.
// We don't show "stale" on a fresh credential — only when we've at
// least tried once.

const STALE_HOURS = 6;

function hoursAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 3_600_000);
}

export default function LastSyncedBanner({
  lastSyncedAt,
  consecutiveFailures,
}: {
  lastSyncedAt: string | null;
  consecutiveFailures: number;
}): React.ReactNode {
  const t = useTranslations("app.processorSync");
  const hrs = hoursAgo(lastSyncedAt);

  if (consecutiveFailures > 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
        <AlertTriangle size={12} />
        <span>
          {t("failing", { count: consecutiveFailures })}
        </span>
      </div>
    );
  }
  if (hrs === null) {
    return (
      <span className="text-[11px] text-slate-500">{t("neverSynced")}</span>
    );
  }
  const stale = hrs >= STALE_HOURS;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] ${
        stale
          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      <Clock size={12} />
      <span>{t("hoursAgo", { hours: hrs })}</span>
    </div>
  );
}
