"use client";

import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Field,
  SelectField,
  TextareaField,
  ErrorBanner,
} from "@/components/app/ui/Field";
import InvoiceTypeRadio, {
  type InvoiceType,
} from "@/components/app/invoices/InvoiceTypeRadio";
import AllocationBanner from "@/components/app/invoices/AllocationBanner";
import { createInvoice, updateDraftInvoice } from "./actions";

export type BusinessOption = {
  id: string;
  legalName: string;
  defaultCurrency: string;
  vatStatus: string;
};

export type ClientOption = {
  id: string;
  legalName: string;
  businessId: string;
};

export type InvoiceLineDraft = {
  description: string;
  quantity: string;
  unitPriceMajor: string;
  vatRate: string;
};

export type InvoiceFormInitial = {
  id: string;
  businessId: string;
  invoiceType: InvoiceType;
  issueDate: string;
  dueDate: string;
  clientId: string;
  currency: string;
  fxRate: string;
  notesHe: string;
  notesEn: string;
  allocationNumber: string;
  lines: InvoiceLineDraft[];
};

type Props = {
  mode: "new" | "edit";
  businesses: ReadonlyArray<BusinessOption>;
  clients: ReadonlyArray<ClientOption>;
  defaultVatRatePct: number;
  /** Active allocation-threshold amount in minor units (string from server). */
  thresholdMinorStr: string;
  initial?: Partial<InvoiceFormInitial>;
};

const CURRENCY_OPTIONS = [
  { value: "ILS", label: "ILS" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
] as const;

function emptyLine(defaultVatRate: string): InvoiceLineDraft {
  return {
    description: "",
    quantity: "1",
    unitPriceMajor: "",
    vatRate: defaultVatRate,
  };
}

// Mirror of computeLineTotals from actions.ts — kept independently so
// the form can render a live total without a round-trip. Server side
// is the authoritative computation; this is presentation only.
function bigintRoundHalfEvenDiv(num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const negative = (num < 0n) !== (den < 0n);
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const q = absNum / absDen;
  const r = absNum % absDen;
  const twiceR = r * 2n;
  let rounded: bigint;
  if (twiceR < absDen) rounded = q;
  else if (twiceR > absDen) rounded = q + 1n;
  else rounded = q % 2n === 0n ? q : q + 1n;
  return negative ? -rounded : rounded;
}

function safeNum(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function computeLinePreview(line: InvoiceLineDraft): {
  subtotal: bigint;
  vat: bigint;
} {
  const qMicro = BigInt(Math.round(safeNum(line.quantity) * 10_000));
  const unitMinor = BigInt(Math.round(safeNum(line.unitPriceMajor) * 100));
  const subtotal = bigintRoundHalfEvenDiv(qMicro * unitMinor, 10_000n);
  const rateMicro = BigInt(Math.round(safeNum(line.vatRate) * 10_000));
  const vat = bigintRoundHalfEvenDiv(subtotal * rateMicro, 1_000_000n);
  return { subtotal, vat };
}

function formatMinor(minor: bigint, currency: string): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const major = abs / 100n;
  const cents = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${majorStr}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default function InvoiceForm({
  mode,
  businesses,
  clients,
  defaultVatRatePct,
  thresholdMinorStr,
  initial,
}: Props): React.ReactNode {
  const t = useTranslations("app.invoices");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultBusinessId =
    initial?.businessId ??
    (businesses.length === 1 ? (businesses[0]?.id ?? "") : "");
  const defaultBusiness = businesses.find((b) => b.id === defaultBusinessId);
  const defaultRate = defaultBusiness?.vatStatus === "osek_patur"
    ? "0.00"
    : defaultVatRatePct.toFixed(2);

  const [businessId, setBusinessId] = useState(defaultBusinessId);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(
    initial?.invoiceType ?? "tax_invoice",
  );
  const [issueDate, setIssueDate] = useState(
    initial?.issueDate ?? new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [currency, setCurrency] = useState(
    initial?.currency ?? defaultBusiness?.defaultCurrency ?? "ILS",
  );
  const [fxRate, setFxRate] = useState(initial?.fxRate ?? "");
  const [notesHe, setNotesHe] = useState(initial?.notesHe ?? "");
  const [notesEn, setNotesEn] = useState(initial?.notesEn ?? "");
  const [allocationNumber, setAllocationNumber] = useState(
    initial?.allocationNumber ?? "",
  );
  const [lines, setLines] = useState<InvoiceLineDraft[]>(
    initial?.lines && initial.lines.length > 0
      ? initial.lines
      : [emptyLine(defaultRate)],
  );

  const activeBusiness = useMemo(
    () => businesses.find((b) => b.id === businessId) ?? null,
    [businesses, businessId],
  );
  const isPatur = activeBusiness?.vatStatus === "osek_patur";

  const visibleClients = useMemo(
    () => clients.filter((c) => c.businessId === businessId),
    [clients, businessId],
  );

  const totals = useMemo(() => {
    let subtotal = 0n;
    let vat = 0n;
    for (const l of lines) {
      const p = computeLinePreview(l);
      subtotal += p.subtotal;
      vat += p.vat;
    }
    return { subtotal, vat, total: subtotal + vat };
  }, [lines]);

  const thresholdMinor = useMemo(
    () => BigInt(thresholdMinorStr || "0"),
    [thresholdMinorStr],
  );

  function setLine(i: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(defaultRate)]);
  }

  function removeLine(i: number) {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!businessId) {
      setError(t("missingBusiness"));
      return;
    }
    // Patur businesses can only invoice at 0%. Snap and warn if the
    // operator typed something else — defensive only; the server also
    // enforces via the VAT engine on Phase D issuance.
    let finalLines = lines;
    if (isPatur) {
      finalLines = lines.map((l) => ({ ...l, vatRate: "0.00" }));
    }

    const linesJson = JSON.stringify(
      finalLines.map((l) => ({
        description: l.description,
        quantity: l.quantity || "0",
        unitPriceMajor: Number.parseFloat(l.unitPriceMajor || "0"),
        vatRate: l.vatRate || "0.00",
      })),
    );

    const fd = new FormData();
    if (mode === "edit" && initial?.id) fd.set("id", initial.id);
    fd.set("businessId", businessId);
    if (clientId) fd.set("clientId", clientId);
    fd.set("invoiceType", invoiceType);
    fd.set("issueDate", issueDate);
    if (dueDate) fd.set("dueDate", dueDate);
    fd.set("currency", currency);
    if (fxRate) fd.set("fxRate", fxRate);
    if (notesHe) fd.set("notesHe", notesHe);
    if (notesEn) fd.set("notesEn", notesEn);
    if (allocationNumber) fd.set("allocationNumber", allocationNumber);
    fd.set("linesJson", linesJson);

    startTransition(async () => {
      const result =
        mode === "new"
          ? await createInvoice(fd)
          : await updateDraftInvoice(fd);
      if (result && "error" in result) {
        setError(translateError(result.error, tCommon, t));
        return;
      }
      if (result && "ok" in result) {
        router.push(`/invoices/${result.id}`);
        router.refresh();
      }
    });
  }

  if (businesses.length === 0) {
    return (
      <div className="glass-strong rounded-2xl p-8 text-center">
        <p className="text-sm text-slate-300">{t("noBusinessYet")}</p>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        {mode === "new" ? t("newTitle") : t("editTitle")}
      </h1>
      <p className="mt-2 text-sm text-slate-400">{t("formIntro")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-6" noValidate>
        <SelectField
          label={t("business")}
          name="businessId"
          value={businessId}
          onChange={setBusinessId}
          options={businesses.map((b) => ({ value: b.id, label: b.legalName }))}
          required
          disabled={pending}
        />

        <InvoiceTypeRadio
          value={invoiceType}
          onChange={setInvoiceType}
          disabled={pending}
          hideCreditNote
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SelectField
            label={t("client")}
            name="clientId"
            value={clientId}
            onChange={setClientId}
            options={[
              { value: "", label: t("clientNone") },
              ...visibleClients.map((c) => ({
                value: c.id,
                label: c.legalName,
              })),
            ]}
            disabled={pending}
            help={t("clientHelp")}
          />
          <Field
            label={t("issueDate")}
            name="issueDate"
            type="date"
            dir="ltr"
            value={issueDate}
            onChange={setIssueDate}
            required
            disabled={pending}
          />
          <Field
            label={t("dueDate")}
            name="dueDate"
            type="date"
            dir="ltr"
            value={dueDate}
            onChange={setDueDate}
            disabled={pending}
          />
          <SelectField
            label={t("currency")}
            name="currency"
            value={currency}
            onChange={setCurrency}
            options={CURRENCY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            required
            disabled={pending}
          />
          {currency !== "ILS" && (
            <Field
              label={t("fxRate")}
              name="fxRate"
              dir="ltr"
              inputMode="decimal"
              value={fxRate}
              onChange={setFxRate}
              help={t("fxRateHelp")}
              disabled={pending}
            />
          )}
        </div>

        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-medium tracking-tight text-slate-200">
              {t("linesHeading")}
            </h2>
            <button
              type="button"
              onClick={addLine}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-60"
            >
              <Plus size={12} />
              {t("addLine")}
            </button>
          </header>

          <div className="space-y-3">
            {lines.map((line, i) => {
              const preview = computeLinePreview(line);
              return (
                <div
                  key={i}
                  className="glass rounded-xl p-3 space-y-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                      <Field
                        label={t("line.description")}
                        name={`line.${i}.description`}
                        value={line.description}
                        onChange={(v) => setLine(i, { description: v })}
                        disabled={pending}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Field
                        label={t("line.quantity")}
                        name={`line.${i}.quantity`}
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        step="0.01"
                        min={0}
                        value={line.quantity}
                        onChange={(v) => setLine(i, { quantity: v })}
                        disabled={pending}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Field
                        label={t("line.unitPrice")}
                        name={`line.${i}.unitPriceMajor`}
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        step="0.01"
                        min={0}
                        value={line.unitPriceMajor}
                        onChange={(v) =>
                          setLine(i, { unitPriceMajor: v })
                        }
                        disabled={pending}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Field
                        label={t("line.vatRate")}
                        name={`line.${i}.vatRate`}
                        type="number"
                        inputMode="decimal"
                        dir="ltr"
                        step="0.01"
                        min={0}
                        max={100}
                        value={line.vatRate}
                        onChange={(v) => setLine(i, { vatRate: v })}
                        disabled={pending || isPatur}
                        {...(isPatur ? { help: t("line.vatRatePaturLocked") } : {})}
                      />
                    </div>
                    <div className="sm:col-span-1 flex items-end justify-end">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={pending || lines.length === 1}
                        className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2.5 py-2.5 text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={t("removeLine")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-end gap-4 text-xs text-slate-400"
                    dir="ltr"
                  >
                    <span>
                      {t("line.subtotalPreview")}{" "}
                      <span className="text-slate-200">
                        {formatMinor(preview.subtotal, currency)}
                      </span>
                    </span>
                    <span>
                      {t("line.vatPreview")}{" "}
                      <span className="text-slate-200">
                        {formatMinor(preview.vat, currency)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-1 rounded-xl border border-white/10 bg-slate-950/40 p-3 sm:grid-cols-3 text-sm">
            <div className="text-slate-400">
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {t("totals.subtotal")}
              </span>
              <p className="mt-0.5 text-slate-100" dir="ltr">
                {formatMinor(totals.subtotal, currency)}
              </p>
            </div>
            <div className="text-slate-400">
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {t("totals.vat")}
              </span>
              <p className="mt-0.5 text-slate-100" dir="ltr">
                {formatMinor(totals.vat, currency)}
              </p>
            </div>
            <div className="text-slate-400">
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {t("totals.total")}
              </span>
              <p className="mt-0.5 text-emerald-200 font-medium" dir="ltr">
                {formatMinor(totals.total, currency)}
              </p>
            </div>
          </div>
        </section>

        <AllocationBanner
          totalMinor={totals.total}
          thresholdMinor={thresholdMinor}
          vatStatus={activeBusiness?.vatStatus ?? "liable"}
          currency={currency}
          allocationNumber={allocationNumber}
          onAllocationNumberChange={setAllocationNumber}
          disabled={pending}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextareaField
            label={t("notesHe")}
            name="notesHe"
            value={notesHe}
            onChange={setNotesHe}
            rows={3}
            disabled={pending}
            dir="rtl"
          />
          <TextareaField
            label={t("notesEn")}
            name="notesEn"
            value={notesEn}
            onChange={setNotesEn}
            rows={3}
            disabled={pending}
            dir="ltr"
          />
        </div>

        <ErrorBanner message={error} />

        <motion.button
          type="submit"
          disabled={pending}
          {...(pending
            ? {}
            : {
                whileHover: { scale: 1.02, y: -1 },
                whileTap: { scale: 0.98 },
              })}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending && <Loader2 size={16} className="animate-spin" />}
          {pending
            ? tCommon("saving")
            : mode === "new"
              ? t("submitCreate")
              : t("submitUpdate")}
        </motion.button>
      </form>
    </motion.section>
  );
}

function translateError(
  code: string,
  tCommon: (key: string) => string,
  tInvoices: (key: string) => string,
): string {
  switch (code) {
    case "app.errors.invalidInput":
      return tCommon("invalidInput");
    case "app.errors.stepUpRequired":
      return tInvoices("errors.stepUpRequired");
    case "app.errors.invoiceImmutable":
      return tInvoices("errors.immutable");
    default:
      return code;
  }
}
