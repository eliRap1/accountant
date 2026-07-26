"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Field, SelectField, ErrorBanner } from "@/components/app/ui/Field";
import ProcessorPicker, {
  PROCESSORS,
} from "@/components/app/processor-sync/ProcessorPicker";
import { connectProcessor } from "../actions";

// Connect-processor wizard. The "API Key" field accepts either a single
// token (Hyp, Grow) or "apiKey:secretKey" for PayPlus — the help text
// explains. The server-action smoke-tests the credential before
// persisting (encrypted under the business DEK).

export default function ConnectForm({
  businesses,
}: {
  businesses: ReadonlyArray<{ id: string; legalName: string }>;
}): React.ReactNode {
  const t = useTranslations("app.processorSync");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [processor, setProcessor] = useState<string>(PROCESSORS[0]);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );

  function submit() {
    if (!businessId) {
      setError(t("errors.businessMissing"));
      return;
    }
    if (!apiKey.trim()) {
      setError(t("errors.apiKeyMissing"));
      return;
    }
    setError(null);
    setConnectionMessage(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("businessId", businessId);
      fd.set("processor", processor);
      fd.set("apiKey", apiKey.trim());
      const result = await connectProcessor(fd);
      if ("error" in result) {
        setError(result.error);
        if (result.connectionMessage) {
          setConnectionMessage(result.connectionMessage);
        }
      } else {
        router.push("/processor-sync");
      }
    });
  }

  return (
    <div className="space-y-4">
      {businesses.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-sm text-amber-100">
          {t("noBusinessYet")}
        </div>
      ) : (
        <>
          <div className="glass rounded-2xl p-4 space-y-4">
            <SelectField
              label={t("business")}
              name="businessId"
              value={businessId}
              onChange={setBusinessId}
              options={businesses.map((b) => ({
                value: b.id,
                label: b.legalName,
              }))}
              disabled={pending}
            />
            <ProcessorPicker
              processor={processor}
              onChange={setProcessor}
              disabled={pending}
            />
            <Field
              label={t("apiKeyLabel")}
              name="apiKey"
              type="password"
              value={apiKey}
              onChange={setApiKey}
              placeholder={t(`apiKeyPlaceholder.${processor}`)}
              help={t(`apiKeyHelp.${processor}`)}
              dir="ltr"
              disabled={pending}
            />
          </div>

          {connectionMessage && (
            <div
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
              dir="ltr"
            >
              {connectionMessage}
            </div>
          )}

          <ErrorBanner message={error} />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60"
            >
              {pending ? t("connecting") : t("connectSubmit")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
