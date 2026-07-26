"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";

// Plain file-drop component — no library, no DnD edge cases beyond
// drag-over/leave + drop. Returns the picked File via onFile. Parent
// converts to base64 before submitting.

export default function DropZone({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
}): React.ReactNode {
  const t = useTranslations("app.bankImports");
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      className={`flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 transition-colors ${
        isDragging
          ? "border-emerald-400/60 bg-emerald-500/10"
          : "border-white/10 bg-slate-950/40 hover:border-emerald-400/40"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFile(f);
        }}
        disabled={disabled ?? false}
      />
      <Upload size={18} className="text-emerald-300" />
      <div className="text-sm">
        {file ? (
          <span className="text-slate-100" dir="ltr">
            {file.name} ({Math.round(file.size / 1024)} KB)
          </span>
        ) : (
          <span className="text-slate-300">{t("dropZone")}</span>
        )}
      </div>
    </div>
  );
}
