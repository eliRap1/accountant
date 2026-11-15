"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Field, ErrorBanner } from "@/components/app/ui/Field";
import FilingStepUpGate from "@/components/app/filings/FilingStepUpGate";
import { markSubmitted } from "../actions";

type Props = {
  filingId: string;
};

// Inline form for the operator to record an out-of-band submission to
// the regulator's portal. Stores the asmachta (portal confirmation
// number) — optional but recommended for the audit trail. Step-up gated.

export default function MarkSubmittedForm({ filingId }: Props): ReactNode {
  const t = useTranslations("app.filings");
  const router = useRouter();
  const [asmachta, setAsmachta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUpRequired, setStepUpRequired] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStepUpRequired(false);
    try {
      const fd = new FormData();
      fd.set("id", filingId);
      fd.set("asmachta", asmachta);
      const result = await markSubmitted(fd);
      if ("error" in result) {
        if (result.error === "app.filings.errors.stepUpRequired") {
          setStepUpRequired(true);
        } else {
          // Translate the error key. We strip the leading "app." so we
          // can resolve through the existing app.filings namespace.
          const key = result.error.replace(/^app\.filings\./, "");
          try {
            setError(t(key as never));
          } catch {
            setError(t("errors.generic"));
          }
        }
        return;
      }
      router.refresh();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <FilingStepUpGate
        required={stepUpRequired}
        onRetry={() => {
          setStepUpRequired(false);
          router.refresh();
        }}
      />
      <ErrorBanner message={error} />
      <Field
        label={t("detail.asmachtaLabel")}
        name="asmachta"
        type="text"
        dir="ltr"
        value={asmachta}
        onChange={setAsmachta}
        placeholder={t("detail.asmachtaPlaceholder")}
        help={t("detail.asmachtaHelp")}
        disabled={busy}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? t("wizard.submitting") : t("detail.submitConfirm")}
        </button>
      </div>
    </form>
  );
}
