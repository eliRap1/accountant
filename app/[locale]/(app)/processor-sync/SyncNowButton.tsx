"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { RefreshCw } from "lucide-react";
import { syncNow } from "./actions";

export default function SyncNowButton({
  credentialId,
}: {
  credentialId: string;
}): React.ReactNode {
  const t = useTranslations("app.processorSync");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("credentialId", credentialId);
      const result = await syncNow(fd);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-60"
      >
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
        {pending ? t("syncing") : t("syncNow")}
      </button>
      {error && (
        <span className="text-[11px] text-red-300" dir="ltr">
          {error}
        </span>
      )}
    </div>
  );
}
