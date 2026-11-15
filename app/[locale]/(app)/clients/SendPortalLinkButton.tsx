"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { issueClientPortalLink } from "./portalActions";

type Props = {
  clientId: string;
  labels: {
    cta: string;
    sent: string;
    failed: string;
  };
};

export default function SendPortalLinkButton({ clientId, labels }: Props) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleClick() {
    setStatus("idle");
    setErrorMsg(null);
    startTransition(async () => {
      const result = await issueClientPortalLink(clientId);
      if ("ok" in result && result.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
        if ("error" in result) {
          setErrorMsg(result.error);
        }
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || status === "sent"}
        className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send size={14} />
        {isPending ? "…" : labels.cta}
      </button>

      {status === "sent" && (
        <p className="text-xs text-emerald-400">{labels.sent}</p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-400">
          {labels.failed}
          {errorMsg ? ` (${errorMsg})` : ""}
        </p>
      )}
    </div>
  );
}
