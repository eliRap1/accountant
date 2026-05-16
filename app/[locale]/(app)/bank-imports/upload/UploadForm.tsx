"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SelectField, ErrorBanner } from "@/components/app/ui/Field";
import BankPicker, {
  BANK_OPTIONS,
} from "@/components/app/bank-imports/BankPicker";
import DropZone from "@/components/app/bank-imports/DropZone";
import { uploadAndParse } from "../actions";

// Upload wizard client. Combines BankPicker + DropZone, calls
// uploadAndParse, navigates to the review page on success.

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Use chunked btoa to avoid blowing the call stack on multi-MB files.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 32_768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export default function UploadForm({
  businesses,
}: {
  businesses: ReadonlyArray<{ id: string; legalName: string }>;
}): React.ReactNode {
  const t = useTranslations("app.bankImports");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [bank, setBank] = useState<string>(BANK_OPTIONS[0].value);
  const [sourceFormat, setSourceFormat] = useState<string>(
    BANK_OPTIONS[0].defaultFormat,
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!file) {
      setError(t("errors.fileMissing"));
      return;
    }
    if (!businessId) {
      setError(t("errors.businessMissing"));
      return;
    }
    setError(null);
    startTransition(async () => {
      let b64: string;
      try {
        b64 = await fileToBase64(file);
      } catch {
        setError(t("errors.readFile"));
        return;
      }
      const fd = new FormData();
      fd.set("businessId", businessId);
      fd.set("bank", bank);
      fd.set("sourceFormat", sourceFormat);
      fd.set("fileName", file.name);
      fd.set("fileBase64", b64);
      const result = await uploadAndParse(fd);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/bank-imports/${result.importId}`);
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
          <div className="glass rounded-2xl p-4">
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
          </div>

          <div className="glass rounded-2xl p-4">
            <BankPicker
              bank={bank}
              sourceFormat={sourceFormat}
              onChangeBank={setBank}
              onChangeFormat={setSourceFormat}
              disabled={pending}
            />
          </div>

          <DropZone file={file} onFile={setFile} disabled={pending} />

          <ErrorBanner message={error} />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending || !file}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60"
            >
              {pending ? t("parsing") : t("parseCta")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
