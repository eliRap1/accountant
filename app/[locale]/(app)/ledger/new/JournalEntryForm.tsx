"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
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
import { createJournalEntry } from "../actions";

export type LedgerBusinessOption = {
  id: string;
  legalName: string;
  bookkeepingMethod: string;
};

export type ChartOfAccountsOption = {
  code: string;
  nameHe: string | null;
  nameEn: string | null;
  type: string;
  businessId: string | null;
};

type LineRow = {
  key: string;
  accountCode: string;
  // Major-unit strings on the form; we convert to minor before posting.
  debitMajor: string;
  creditMajor: string;
  description: string;
};

type Props = {
  businesses: ReadonlyArray<LedgerBusinessOption>;
  categories: ReadonlyArray<ChartOfAccountsOption>;
};

function emptyLine(): LineRow {
  return {
    key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    accountCode: "",
    debitMajor: "",
    creditMajor: "",
    description: "",
  };
}

function majorToMinor(major: string): number {
  if (!major.trim()) return 0;
  const n = Number(major);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export default function JournalEntryForm({ businesses, categories }: Props) {
  const t = useTranslations("app.ledger");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [businessId, setBusinessId] = useState<string>(
    businesses[0]?.id ?? "",
  );
  const [entryDate, setEntryDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState<string>("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine(), emptyLine()]);

  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (c) => c.businessId === null || c.businessId === businessId,
      ),
    [categories, businessId],
  );

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) =>
      prev.length <= 2 ? prev : prev.filter((l) => l.key !== key),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  const totalDebitMinor = lines.reduce(
    (s, l) => s + majorToMinor(l.debitMajor),
    0,
  );
  const totalCreditMinor = lines.reduce(
    (s, l) => s + majorToMinor(l.creditMajor),
    0,
  );
  const balanced = totalDebitMinor === totalCreditMinor && totalDebitMinor > 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!businessId) {
      setError(t("missingBusiness"));
      return;
    }
    if (!balanced) {
      setError(tCommon("unbalancedEntry"));
      return;
    }
    // Each line must have a code + XOR debit/credit (positive).
    const cleanLines = lines.map((l) => ({
      accountCode: l.accountCode.trim(),
      debitMinor: majorToMinor(l.debitMajor),
      creditMinor: majorToMinor(l.creditMajor),
      description: l.description.trim(),
    }));
    const invalid = cleanLines.find(
      (l) =>
        !l.accountCode ||
        (l.debitMinor > 0 && l.creditMinor > 0) ||
        (l.debitMinor === 0 && l.creditMinor === 0),
    );
    if (invalid) {
      setError(tCommon("invalidInput"));
      return;
    }

    startTransition(async () => {
      const result = await createJournalEntry({
        businessId,
        entryDate,
        description,
        lines: cleanLines,
      });
      if ("error" in result) {
        if (result.error === "app.errors.unbalancedEntry") {
          setError(tCommon("unbalancedEntry"));
        } else {
          setError(tCommon("invalidInput"));
        }
        return;
      }
      router.push("/ledger");
      router.refresh();
    });
  }

  if (businesses.length === 0) {
    return (
      <div className="glass-strong rounded-2xl p-8 text-center">
        <p className="text-sm text-slate-300">
          {t("placeholderDoubleEntryOnly")}
        </p>
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
        {t("newTitle")}
      </h1>
      <p className="mt-2 text-sm text-slate-400">{t("newIntro")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <SelectField
          label={t("business")}
          name="businessId"
          value={businessId}
          onChange={setBusinessId}
          options={businesses.map((b) => ({
            value: b.id,
            label: b.legalName,
          }))}
          required
          disabled={pending}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label={t("entryDate")}
            name="entryDate"
            type="date"
            dir="ltr"
            value={entryDate}
            onChange={setEntryDate}
            required
            disabled={pending}
          />
        </div>
        <TextareaField
          label={t("description")}
          name="description"
          value={description}
          onChange={setDescription}
          rows={2}
          disabled={pending}
        />

        <div>
          <h2 className="text-sm font-medium tracking-tight text-slate-200">
            {t("linesHeading")}
          </h2>
          <div className="mt-3 space-y-3">
            {lines.map((line, idx) => (
              <div
                key={line.key}
                className="glass rounded-xl p-3 space-y-3"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`accountCode-${line.key}`}
                      className="block text-xs text-slate-400"
                    >
                      {t("line.accountCode")} #{idx + 1}
                    </label>
                    <input
                      id={`accountCode-${line.key}`}
                      list={`accountCode-options-${idx}`}
                      value={line.accountCode}
                      onChange={(e) =>
                        updateLine(line.key, { accountCode: e.target.value })
                      }
                      disabled={pending}
                      dir="ltr"
                      className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                      placeholder="0000"
                      required
                    />
                    <datalist id={`accountCode-options-${idx}`}>
                      {visibleCategories.map((c) => (
                        <option
                          key={`${c.businessId ?? "std"}-${c.code}`}
                          value={c.code}
                        >
                          {c.code} · {c.nameHe ?? c.nameEn ?? ""}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label
                      htmlFor={`debit-${line.key}`}
                      className="block text-xs text-slate-400"
                    >
                      {t("line.debit")}
                    </label>
                    <input
                      id={`debit-${line.key}`}
                      type="number"
                      step="0.01"
                      min={0}
                      dir="ltr"
                      value={line.debitMajor}
                      onChange={(e) =>
                        updateLine(line.key, {
                          debitMajor: e.target.value,
                          // XOR enforcement: typing debit blanks the credit.
                          creditMajor:
                            e.target.value && Number(e.target.value) > 0
                              ? ""
                              : line.creditMajor,
                        })
                      }
                      disabled={
                        pending ||
                        (line.creditMajor !== "" &&
                          Number(line.creditMajor) > 0)
                      }
                      className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`credit-${line.key}`}
                      className="block text-xs text-slate-400"
                    >
                      {t("line.credit")}
                    </label>
                    <input
                      id={`credit-${line.key}`}
                      type="number"
                      step="0.01"
                      min={0}
                      dir="ltr"
                      value={line.creditMajor}
                      onChange={(e) =>
                        updateLine(line.key, {
                          creditMajor: e.target.value,
                          debitMajor:
                            e.target.value && Number(e.target.value) > 0
                              ? ""
                              : line.debitMajor,
                        })
                      }
                      disabled={
                        pending ||
                        (line.debitMajor !== "" && Number(line.debitMajor) > 0)
                      }
                      className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      disabled={pending || lines.length <= 2}
                      className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2 py-2 text-slate-400 transition-colors hover:border-red-400/40 hover:text-red-200 disabled:opacity-30"
                      aria-label={t("line.remove")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor={`lineDesc-${line.key}`}
                    className="block text-xs text-slate-400"
                  >
                    {t("line.description")}
                  </label>
                  <input
                    id={`lineDesc-${line.key}`}
                    type="text"
                    value={line.description}
                    onChange={(e) =>
                      updateLine(line.key, { description: e.target.value })
                    }
                    disabled={pending}
                    className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLine}
            disabled={pending}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            <Plus size={12} />
            {t("line.add")}
          </button>
        </div>

        <div
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            balanced
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-400/40 bg-red-500/10 text-red-200"
          }`}
        >
          <span>{t("balancePreview")}</span>
          <span dir="ltr" className="font-medium">
            {(totalDebitMinor / 100).toFixed(2)} /{" "}
            {(totalCreditMinor / 100).toFixed(2)}
          </span>
        </div>

        <ErrorBanner message={error} />

        <motion.button
          type="submit"
          disabled={pending || !balanced}
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
          {pending ? tCommon("saving") : t("submit")}
        </motion.button>
      </form>
    </motion.section>
  );
}
