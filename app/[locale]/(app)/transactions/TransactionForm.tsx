"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Field,
  SelectField,
  TextareaField,
  ErrorBanner,
} from "@/components/app/ui/Field";
import {
  createTransaction,
  updateTransaction,
  createFinancialAccount,
} from "./actions";

export type TransactionFormValues = {
  id?: string;
  businessId: string;
  financialAccountId: string;
  direction: "income" | "expense" | "transfer";
  amountMajor: string;
  currency: string;
  categoryCode: string;
  description: string;
  txnDate: string;
};

export type BusinessOption = {
  id: string;
  legalName: string;
  defaultCurrency: string;
};

export type FinancialAccountOption = {
  id: string;
  name: string;
  currency: string;
  businessId: string;
};

export type ChartOfAccountsOption = {
  code: string;
  nameHe: string | null;
  nameEn: string | null;
  type: string;
  businessId: string | null;
};

type Props = {
  mode: "new" | "edit";
  businesses: ReadonlyArray<BusinessOption>;
  accounts: ReadonlyArray<FinancialAccountOption>;
  categories: ReadonlyArray<ChartOfAccountsOption>;
  initial?: Partial<TransactionFormValues>;
};

const CURRENCY_OPTIONS = [
  { value: "ILS", label: "ILS" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
] as const;

export default function TransactionForm({
  mode,
  businesses,
  accounts,
  categories,
  initial,
}: Props) {
  const t = useTranslations("app.transactions");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultBusinessId =
    initial?.businessId ??
    (businesses.length === 1 ? (businesses[0]?.id ?? "") : "");
  const defaultBusiness = businesses.find((b) => b.id === defaultBusinessId);

  const [values, setValues] = useState<TransactionFormValues>({
    businessId: defaultBusinessId,
    financialAccountId: initial?.financialAccountId ?? "",
    direction: initial?.direction ?? "income",
    amountMajor: initial?.amountMajor ?? "",
    currency: initial?.currency ?? defaultBusiness?.defaultCurrency ?? "ILS",
    categoryCode: initial?.categoryCode ?? "",
    description: initial?.description ?? "",
    txnDate: initial?.txnDate ?? new Date().toISOString().slice(0, 10),
    ...(initial?.id !== undefined ? { id: initial.id } : {}),
  });

  // Local mutable accounts list — we can append new ones via the inline
  // "+ New account" path without round-tripping the whole page.
  const [localAccounts, setLocalAccounts] = useState<FinancialAccountOption[]>([
    ...accounts,
  ]);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");

  function set<K extends keyof TransactionFormValues>(
    key: K,
    v: TransactionFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  const visibleAccounts = useMemo(
    () => localAccounts.filter((a) => a.businessId === values.businessId),
    [localAccounts, values.businessId],
  );

  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (c) => c.businessId === null || c.businessId === values.businessId,
      ),
    [categories, values.businessId],
  );

  async function onCreateAccount() {
    if (!values.businessId || !newAccountName.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("businessId", values.businessId);
    fd.set("name", newAccountName.trim());
    fd.set("kind", "other");
    fd.set("currency", values.currency);
    startTransition(async () => {
      const result = await createFinancialAccount(fd);
      if ("error" in result) {
        setError(translateError(result.error, tCommon));
        return;
      }
      setLocalAccounts((prev) => [
        ...prev,
        {
          id: result.id,
          name: result.name,
          currency: values.currency,
          businessId: values.businessId,
        },
      ]);
      set("financialAccountId", result.id);
      setShowNewAccount(false);
      setNewAccountName("");
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!values.businessId) {
      setError(t("missingBusiness"));
      return;
    }
    const fd = new FormData();
    if (mode === "edit" && values.id) fd.set("id", values.id);
    fd.set("businessId", values.businessId);
    fd.set("financialAccountId", values.financialAccountId);
    fd.set("direction", values.direction);
    fd.set("amountMajor", values.amountMajor);
    fd.set("currency", values.currency);
    fd.set("categoryCode", values.categoryCode);
    fd.set("description", values.description);
    fd.set("txnDate", values.txnDate);

    startTransition(async () => {
      const result =
        mode === "new"
          ? await createTransaction(fd)
          : await updateTransaction(fd);
      if (result && "error" in result) {
        setError(translateError(result.error, tCommon));
        return;
      }
      if (result && "ok" in result) {
        router.push(`/transactions/${result.id}`);
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

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <SelectField
          label={t("business")}
          name="businessId"
          value={values.businessId}
          onChange={(v) => set("businessId", v)}
          options={businesses.map((b) => ({ value: b.id, label: b.legalName }))}
          required
          disabled={pending}
        />

        <div className="space-y-2">
          <SelectField
            label={t("financialAccount")}
            name="financialAccountId"
            value={values.financialAccountId}
            onChange={(v) => set("financialAccountId", v)}
            options={[
              { value: "", label: t("accountUnallocated") },
              ...visibleAccounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.currency})`,
              })),
            ]}
            disabled={pending}
          />
          {!showNewAccount ? (
            <button
              type="button"
              onClick={() => setShowNewAccount(true)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition-colors disabled:opacity-50"
            >
              <Plus size={12} />
              {t("addAccountInline")}
            </button>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={t("newAccountName")}
                  name="newAccountName"
                  value={newAccountName}
                  onChange={setNewAccountName}
                  disabled={pending}
                />
              </div>
              <button
                type="button"
                onClick={onCreateAccount}
                disabled={pending || !newAccountName.trim()}
                className="mb-px inline-flex items-center justify-center rounded-lg bg-emerald-500/90 px-3 py-2.5 text-xs font-medium text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
              >
                {t("addAccountSubmit")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewAccount(false);
                  setNewAccountName("");
                }}
                disabled={pending}
                className="mb-px inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-2.5 text-xs text-slate-300 hover:border-white/20"
              >
                {tCommon("cancel")}
              </button>
            </div>
          )}
        </div>

        <fieldset className="space-y-2" aria-label={t("direction")}>
          <legend className="block text-sm text-slate-300">
            {t("direction")}
          </legend>
          <div className="flex gap-2">
            {(["income", "expense", "transfer"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => set("direction", d)}
                disabled={pending}
                aria-pressed={values.direction === d}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  values.direction === d
                    ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                    : "border-white/10 bg-slate-950/40 text-slate-300 hover:border-white/20"
                }`}
              >
                {t(`directionOption.${d}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field
            label={t("amount")}
            name="amountMajor"
            type="number"
            dir="ltr"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={values.amountMajor}
            onChange={(v) => set("amountMajor", v)}
            required
            disabled={pending}
            help={t("amountHelp")}
          />
          <SelectField
            label={t("currency")}
            name="currency"
            value={values.currency}
            onChange={(v) => set("currency", v)}
            options={CURRENCY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            required
            disabled={pending}
          />
          <Field
            label={t("txnDate")}
            name="txnDate"
            type="date"
            dir="ltr"
            value={values.txnDate}
            onChange={(v) => set("txnDate", v)}
            required
            disabled={pending}
          />
        </div>

        <div>
          <label htmlFor="categoryCode" className="block text-sm text-slate-300">
            {t("category")}
          </label>
          <input
            id="categoryCode"
            name="categoryCode"
            list="category-options"
            value={values.categoryCode}
            onChange={(e) => set("categoryCode", e.target.value)}
            disabled={pending}
            dir="ltr"
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
            placeholder={t("categoryPlaceholder")}
          />
          <datalist id="category-options">
            {visibleCategories.map((c) => (
              <option
                key={`${c.businessId ?? "std"}-${c.code}`}
                value={c.code}
              >
                {c.code} · {c.nameHe ?? c.nameEn ?? ""}
              </option>
            ))}
          </datalist>
          <span className="mt-1 block text-[11px] text-slate-500">
            {t("categoryHelp")}
          </span>
        </div>

        <TextareaField
          label={t("description")}
          name="description"
          value={values.description}
          onChange={(v) => set("description", v)}
          rows={2}
          disabled={pending}
        />

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
): string {
  switch (code) {
    case "app.errors.invalidInput":
      return tCommon("invalidInput");
    default:
      return code;
  }
}
