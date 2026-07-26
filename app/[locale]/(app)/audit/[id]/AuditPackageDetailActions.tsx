"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";

type Props = {
  packageId: string;
  isReady: boolean;
};

// Download button. Hits GET /api/audit/:id/download; on 200 forces a
// browser download. On 401 step_up_required, surfaces the directive
// so the user can re-prompt step-up. On 401 dek_retired, surfaces
// the crypto-erasure case so the user knows the package is sealed.
export default function AuditPackageDetailActions({
  packageId,
  isReady,
}: Props) {
  const t = useTranslations("app.audit");
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");

  async function onDownload() {
    setDownloading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/audit/${packageId}/download`, {
        method: "GET",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401 && body.error === "step_up_required") {
          setMessage(t("errors.stepUpRequired"));
          setMessageKind("error");
        } else if (res.status === 401 && body.error === "dek_retired") {
          setMessage(t("errors.dekRetired"));
          setMessageKind("error");
        } else if (res.status === 403) {
          setMessage(t("errors.forbidden"));
          setMessageKind("error");
        } else if (res.status === 404 && body.error === "not_ready") {
          setMessage(t("errors.notReady"));
          setMessageKind("error");
        } else {
          setMessage(t("errors.generic"));
          setMessageKind("error");
        }
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-package-${packageId}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage(t("errors.generic"));
      setMessageKind("error");
    } finally {
      setDownloading(false);
    }
  }

  if (!isReady) {
    return (
      <p className="text-sm text-slate-400">{t("errors.notReady")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        <Download size={14} aria-hidden />
        {downloading ? t("downloadingLabel") : t("downloadCta")}
      </button>
      {message && (
        <p
          className={
            messageKind === "error"
              ? "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              : "text-sm text-slate-400"
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
