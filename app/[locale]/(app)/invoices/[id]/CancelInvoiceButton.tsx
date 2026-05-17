"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Ban, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { TextareaField, ErrorBanner } from "@/components/app/ui/Field";
import StepUpModal, { type StepUpEnvelope } from "@/components/app/StepUpModal";
import { cancelInvoice } from "../actions";

type Props = { invoiceId: string };

// "Cancel" in IL invoicing means "emit a linked credit_note". We never
// hard-delete a committed invoice — this button drops a confirmation
// dialog so the operator types a written reason, then posts to the
// cancelInvoice action which calls the provider's cancelInvoice path.
export default function CancelInvoiceButton({
  invoiceId,
}: Props): React.ReactNode {
  const t = useTranslations("app.invoices");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [stepUp, setStepUp] = useState<StepUpEnvelope | null>(null);
  const [pendingFd, setPendingFd] = useState<FormData | null>(null);

  function buildFormData() {
    const fd = new FormData();
    fd.set("id", invoiceId);
    fd.set("reason", reason.trim());
    fd.set("issueDate", new Date().toISOString().slice(0, 10));
    return fd;
  }

  function runCancel(fd: FormData) {
    startTransition(async () => {
      const result = await cancelInvoice(fd);
      if (result && "stepUpRequired" in result) {
        setPendingFd(fd);
        setStepUp(result.stepUpRequired);
        return;
      }
      if (result && "error" in result) {
        setError(translateError(result.error, tCommon));
        return;
      }
      if (result && "ok" in result) {
        setOpen(false);
        router.push(`/invoices/${result.id}`);
        router.refresh();
      }
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError(t("cancel.errors.reasonRequired"));
      return;
    }
    runCancel(buildFormData());
  }

  function onStepUpGranted() {
    setStepUp(null);
    if (!pendingFd) return;
    runCancel(pendingFd);
  }

  if (!open) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/20"
        >
          <Ban size={14} />
          {t("cancel.cta")}
        </button>
        <StepUpModal
          envelope={stepUp}
          onClose={() => setStepUp(null)}
          onGranted={onStepUpGranted}
        />
      </>
    );
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="false"
        className="glass-strong rounded-2xl p-5 w-full sm:w-[28rem] space-y-3 ring-1 ring-red-400/30"
      >
        <header>
          <h2 className="text-sm font-medium tracking-tight text-red-200">
            {t("cancel.dialogTitle")}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {t("cancel.dialogBody")}
          </p>
        </header>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <TextareaField
            label={t("cancel.reasonLabel")}
            name="reason"
            value={reason}
            onChange={setReason}
            rows={3}
            disabled={pending}
            required
          />
          <ErrorBanner message={error} />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setReason("");
                setError(null);
              }}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/20 disabled:opacity-60"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={pending || !reason.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-red-500/90 px-3 py-2 text-xs font-medium text-slate-950 transition-colors hover:bg-red-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending && <Loader2 size={12} className="animate-spin" />}
              {t("cancel.confirm")}
            </button>
          </div>
        </form>
      </div>
      <StepUpModal
        envelope={stepUp}
        onClose={() => setStepUp(null)}
        onGranted={onStepUpGranted}
      />
    </>
  );
}

function translateError(
  code: string,
  tCommon: (key: string) => string,
): string {
  switch (code) {
    case "app.errors.invalidInput":
      return tCommon("invalidInput");
    default:
      return code;
  }
}
