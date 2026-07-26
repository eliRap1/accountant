"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  updateReceiptParsedFields,
  approveReceipt,
  rejectReceipt,
  type ReceiptActionResult,
} from "./actions";

type Props = {
  receiptId: string;
  initial: {
    parsedAmountMajor: string;
    parsedVatMajor: string;
    parsedDate: string;
    parsedVendor: string;
    categoryCode: string;
    businessUsePct: string;
  };
  status: "pending_review" | "approved" | "rejected";
  linkedTransactionId: string | null;
  linkedInvoiceId: string | null;
};

export default function ReceiptReviewForm({
  receiptId,
  initial,
  status,
  linkedTransactionId,
  linkedInvoiceId,
}: Props): React.ReactNode {
  const t = useTranslations("app.receipts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendor, setVendor] = useState(initial.parsedVendor);
  const [amount, setAmount] = useState(initial.parsedAmountMajor);
  const [vat, setVat] = useState(initial.parsedVatMajor);
  const [date, setDate] = useState(initial.parsedDate);
  const [categoryCode, setCategoryCode] = useState(initial.categoryCode);
  const [businessUsePct, setBusinessUsePct] = useState(initial.businessUsePct);
  const [error, setError] = useState<string | null>(null);

  const readOnly = status !== "pending_review";

  function withResult(
    promise: Promise<ReceiptActionResult>,
    onOk?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const r = await promise;
      if ("error" in r) {
        setError(r.error);
      } else {
        onOk?.();
        router.refresh();
      }
    });
  }

  function onSave() {
    const fd = new FormData();
    fd.set("id", receiptId);
    fd.set("parsedAmountMajor", amount);
    fd.set("parsedVatMajor", vat);
    fd.set("parsedDate", date);
    fd.set("parsedVendor", vendor);
    fd.set("categoryCode", categoryCode);
    fd.set("businessUsePct", businessUsePct || "100.00");
    withResult(updateReceiptParsedFields(fd));
  }

  function onApprove() {
    const fd = new FormData();
    fd.set("id", receiptId);
    // Save first so the approval reads the operator's edits.
    const saveFd = new FormData();
    saveFd.set("id", receiptId);
    saveFd.set("parsedAmountMajor", amount);
    saveFd.set("parsedVatMajor", vat);
    saveFd.set("parsedDate", date);
    saveFd.set("parsedVendor", vendor);
    saveFd.set("categoryCode", categoryCode);
    saveFd.set("businessUsePct", businessUsePct || "100.00");
    startTransition(async () => {
      setError(null);
      const saveR = await updateReceiptParsedFields(saveFd);
      if ("error" in saveR) {
        setError(saveR.error);
        return;
      }
      const approveR = await approveReceipt(fd);
      if ("error" in approveR) {
        setError(approveR.error);
        return;
      }
      router.refresh();
    });
  }

  function onReject() {
    const fd = new FormData();
    fd.set("id", receiptId);
    withResult(rejectReceipt(fd));
  }

  return (
    <div className="space-y-6">
      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("review.title")}
        </h2>
        <p className="mt-1 text-xs text-slate-500">{t("review.subtitle")}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldText
            label={t("review.vendor")}
            value={vendor}
            onChange={setVendor}
            disabled={pending || readOnly}
          />
          <FieldText
            label={t("review.date")}
            type="date"
            value={date}
            onChange={setDate}
            disabled={pending || readOnly}
            dir="ltr"
          />
          <FieldText
            label={t("review.amount")}
            value={amount}
            onChange={setAmount}
            disabled={pending || readOnly}
            inputMode="decimal"
            dir="ltr"
          />
          <FieldText
            label={t("review.vat")}
            value={vat}
            onChange={setVat}
            disabled={pending || readOnly}
            inputMode="decimal"
            dir="ltr"
          />
          <FieldText
            label={t("review.category")}
            value={categoryCode}
            onChange={setCategoryCode}
            disabled={pending || readOnly}
            dir="ltr"
            placeholder="8000"
          />
          <label className="block">
            <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("review.businessUsePct")}
            </span>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Number.parseFloat(businessUsePct || "100")}
                onChange={(e) => setBusinessUsePct(`${e.target.value}.00`)}
                disabled={pending || readOnly}
                className="h-2 flex-1 accent-emerald-500"
              />
              <span
                className="w-16 text-end text-sm text-slate-200 tabular-nums"
                dir="ltr"
              >
                {Number.parseFloat(businessUsePct || "100").toFixed(0)}%
              </span>
            </div>
          </label>
        </div>
        {error ? (
          <p className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t("review.errors.generic")}
          </p>
        ) : null}
      </section>

      {!readOnly ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onReject}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {t("review.reject")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-50"
          >
            {t("review.save")}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-medium text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {t("review.approve")}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {linkedTransactionId ? (
          <a
            href={`/transactions/${linkedTransactionId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
          >
            {t("review.linkTransaction")}
          </a>
        ) : null}
        {linkedInvoiceId ? (
          <a
            href={`/invoices/${linkedInvoiceId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
          >
            {t("review.linkInvoice")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  inputMode,
  dir = "auto",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
  dir?: "ltr" | "rtl" | "auto";
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled ?? false}
        dir={dir}
        inputMode={inputMode}
        placeholder={placeholder ?? ""}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none disabled:opacity-60"
      />
    </label>
  );
}
