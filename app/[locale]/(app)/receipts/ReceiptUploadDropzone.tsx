"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Upload, FileText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf" as const;
const MAX_BYTES = 4 * 1024 * 1024;

type Business = { id: string; legalName: string };

type Stage =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "parsing"; receiptId: string }
  | { kind: "error"; message: string };

export default function ReceiptUploadDropzone({
  businesses,
  defaultBusinessId,
}: {
  businesses: ReadonlyArray<Business>;
  defaultBusinessId: string | null;
}): React.ReactNode {
  const t = useTranslations("app.receipts");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [businessId, setBusinessId] = useState<string>(
    defaultBusinessId ?? businesses[0]?.id ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function pickFile(f: File | null) {
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setStage({ kind: "error", message: t("upload.error.tooLarge") });
      return;
    }
    setStage({ kind: "idle" });
    setFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    pickFile(e.dataTransfer.files[0] ?? null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !businessId) return;
    setStage({ kind: "uploading" });
    const fd = new FormData();
    fd.set("businessId", businessId);
    fd.set("file", file);
    let uploadRes: Response;
    try {
      uploadRes = await fetch("/api/receipts/upload", {
        method: "POST",
        body: fd,
      });
    } catch {
      setStage({ kind: "error", message: t("upload.error.network") });
      return;
    }
    if (!uploadRes.ok) {
      const body = (await uploadRes.json().catch(() => null)) as
        | { error?: string }
        | null;
      setStage({
        kind: "error",
        message: t(`upload.error.${body?.error ?? "generic"}`),
      });
      return;
    }
    const uploadBody = (await uploadRes.json()) as { id: string };
    setStage({ kind: "parsing", receiptId: uploadBody.id });

    // Fire-and-redirect: kick off OCR but don't wait beyond a short
    // window. The detail page polls / re-renders the parsed fields
    // once the row updates.
    try {
      await fetch("/api/receipts/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: uploadBody.id }),
      });
    } catch {
      // OCR is best-effort. The detail page handles missing parsed_*.
    }

    startTransition(() => {
      router.push(`/receipts/${uploadBody.id}`);
    });
  }

  const busy = stage.kind === "uploading" || stage.kind === "parsing" || isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <label className="block">
        <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
          {t("upload.business")}
        </span>
        <select
          required
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none"
        >
          {businesses.length === 0 ? (
            <option value="">{t("upload.noBusinesses")}</option>
          ) : null}
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.legalName}
            </option>
          ))}
        </select>
      </label>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="glass-strong rounded-2xl border border-dashed border-white/15 p-8 text-center transition-colors hover:border-emerald-400/40"
      >
        {file ? (
          <div className="flex items-center justify-center gap-4">
            <FileText size={28} className="text-emerald-300" />
            <div className="text-start">
              <p className="text-sm text-slate-100" dir="ltr">
                {file.name}
              </p>
              <p className="text-xs text-slate-500" dir="ltr">
                {(file.size / 1024).toFixed(1)} KB · {file.type}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="ms-3 inline-flex items-center justify-center rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-red-400/40 hover:text-red-200"
              aria-label={t("upload.clear")}
              disabled={busy}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={28} className="mx-auto text-slate-400" />
            <p className="text-sm text-slate-300">{t("upload.dropHint")}</p>
            <p className="text-xs text-slate-500">{t("upload.allowed")}</p>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
            disabled={busy}
          >
            <Upload size={14} />
            {t("upload.pickFile")}
          </button>
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
            disabled={busy}
          >
            <Camera size={14} />
            {t("upload.openCamera")}
          </button>
        </div>
      </div>

      {stage.kind === "error" ? (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {stage.message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={busy || !file || !businessId}
          className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-medium text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-50"
        >
          {stage.kind === "uploading"
            ? t("upload.statusUploading")
            : stage.kind === "parsing"
              ? t("upload.statusParsing")
              : t("upload.submit")}
        </button>
      </div>
    </form>
  );
}
