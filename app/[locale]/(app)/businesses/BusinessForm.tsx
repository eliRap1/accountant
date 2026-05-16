"use client";

import { useState, useTransition, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Field,
  SelectField,
  ErrorBanner,
} from "@/components/app/ui/Field";
import { createBusiness, updateBusiness } from "./actions";

export type BusinessFormValues = {
  id?: string;
  legalName: string;
  vatId: string;
  entityType: string;
  vatStatus: string;
  bookkeepingMethod: string;
  taxYearEndMonth: number;
  advanceTaxRatePct: string;
  tikNikuyim: string;
  defaultCurrency: string;
  addressStreet: string;
  addressCity: string;
  addressPostalCode: string;
  addressCountry: string;
  ilMunicipalAuthority: string;
};

type Props = {
  mode: "new" | "edit";
  initial?: Partial<BusinessFormValues>;
};

const ENTITY_OPTIONS = [
  { value: "patur", label: "עוסק פטור" },
  { value: "morshe", label: "עוסק מורשה" },
  { value: "hevra_baam", label: "חברה בע״מ" },
  { value: "amuta", label: "עמותה" },
  { value: "shutfut", label: "שותפות" },
] as const;

const VAT_OPTIONS = [
  { value: "liable", label: "liable" },
  { value: "osek_patur", label: "osek_patur" },
  { value: "osek_morshe", label: "osek_morshe" },
  { value: "exporter", label: "exporter" },
  { value: "nonprofit", label: "nonprofit" },
] as const;

const BOOKKEEPING_OPTIONS = [
  { value: "single_entry", label: "single_entry" },
  { value: "double_entry", label: "double_entry" },
] as const;

const CURRENCY_OPTIONS = [
  { value: "ILS", label: "ILS" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
] as const;

export default function BusinessForm({ mode, initial }: Props) {
  const t = useTranslations("app.businesses");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<BusinessFormValues>({
    legalName: initial?.legalName ?? "",
    vatId: initial?.vatId ?? "",
    entityType: initial?.entityType ?? "patur",
    vatStatus: initial?.vatStatus ?? "osek_patur",
    bookkeepingMethod: initial?.bookkeepingMethod ?? "single_entry",
    taxYearEndMonth: initial?.taxYearEndMonth ?? 12,
    advanceTaxRatePct: initial?.advanceTaxRatePct ?? "",
    tikNikuyim: initial?.tikNikuyim ?? "",
    defaultCurrency: initial?.defaultCurrency ?? "ILS",
    addressStreet: initial?.addressStreet ?? "",
    addressCity: initial?.addressCity ?? "",
    addressPostalCode: initial?.addressPostalCode ?? "",
    addressCountry: initial?.addressCountry ?? "IL",
    ilMunicipalAuthority: initial?.ilMunicipalAuthority ?? "",
    ...(initial?.id !== undefined ? { id: initial.id } : {}),
  });

  function set<K extends keyof BusinessFormValues>(
    key: K,
    v: BusinessFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    if (mode === "edit" && values.id) fd.set("id", values.id);
    fd.set("legalName", values.legalName);
    fd.set("vatId", values.vatId);
    fd.set("entityType", values.entityType);
    fd.set("vatStatus", values.vatStatus);
    fd.set("bookkeepingMethod", values.bookkeepingMethod);
    fd.set("taxYearEndMonth", String(values.taxYearEndMonth));
    fd.set("advanceTaxRatePct", values.advanceTaxRatePct);
    fd.set("tikNikuyim", values.tikNikuyim);
    fd.set("defaultCurrency", values.defaultCurrency);
    fd.set("addressStreet", values.addressStreet);
    fd.set("addressCity", values.addressCity);
    fd.set("addressPostalCode", values.addressPostalCode);
    fd.set("addressCountry", values.addressCountry);
    fd.set("ilMunicipalAuthority", values.ilMunicipalAuthority);

    startTransition(async () => {
      const result =
        mode === "new"
          ? await createBusiness(fd)
          : await updateBusiness(fd);
      if (result && "error" in result) {
        setError(translateError(result.error, tCommon));
        return;
      }
      if (result && "ok" in result) {
        router.push(`/businesses/${result.id}`);
        router.refresh();
      }
    });
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
        <Field
          label={t("legalName")}
          name="legalName"
          value={values.legalName}
          onChange={(v) => set("legalName", v)}
          required
          disabled={pending}
        />
        <Field
          label={t("vatId")}
          name="vatId"
          dir="ltr"
          inputMode="numeric"
          value={values.vatId}
          onChange={(v) => set("vatId", v)}
          help={t("vatIdHelp")}
          required
          disabled={pending}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SelectField
            label={t("entityType")}
            name="entityType"
            value={values.entityType}
            onChange={(v) => set("entityType", v)}
            options={ENTITY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            required
            disabled={pending}
          />
          <SelectField
            label={t("vatStatus")}
            name="vatStatus"
            value={values.vatStatus}
            onChange={(v) => set("vatStatus", v)}
            options={VAT_OPTIONS.map((o) => ({
              value: o.value,
              label: t(`vatStatusOption.${o.value}`),
            }))}
            required
            disabled={pending}
          />
          <SelectField
            label={t("bookkeepingMethod")}
            name="bookkeepingMethod"
            value={values.bookkeepingMethod}
            onChange={(v) => set("bookkeepingMethod", v)}
            options={BOOKKEEPING_OPTIONS.map((o) => ({
              value: o.value,
              label: t(`bookkeepingOption.${o.value}`),
            }))}
            required
            disabled={pending}
          />
          <SelectField
            label={t("defaultCurrency")}
            name="defaultCurrency"
            value={values.defaultCurrency}
            onChange={(v) => set("defaultCurrency", v)}
            options={CURRENCY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            required
            disabled={pending}
          />
          <Field
            label={t("taxYearEndMonth")}
            name="taxYearEndMonth"
            type="number"
            dir="ltr"
            inputMode="numeric"
            min={1}
            max={12}
            value={String(values.taxYearEndMonth)}
            onChange={(v) => set("taxYearEndMonth", Number(v) || 12)}
            disabled={pending}
          />
          <Field
            label={t("advanceTaxRatePct")}
            name="advanceTaxRatePct"
            type="number"
            dir="ltr"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={100}
            value={values.advanceTaxRatePct}
            onChange={(v) => set("advanceTaxRatePct", v)}
            disabled={pending}
            help={t("advanceTaxRatePctHelp")}
          />
        </div>
        <Field
          label={t("tikNikuyim")}
          name="tikNikuyim"
          dir="ltr"
          value={values.tikNikuyim}
          onChange={(v) => set("tikNikuyim", v)}
          help={t("tikNikuyimHelp")}
          disabled={pending}
        />

        <h2 className="pt-4 text-sm font-medium tracking-tight text-slate-200">
          {t("addressHeading")}
        </h2>
        <Field
          label={t("addressStreet")}
          name="addressStreet"
          value={values.addressStreet}
          onChange={(v) => set("addressStreet", v)}
          disabled={pending}
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field
            label={t("addressCity")}
            name="addressCity"
            value={values.addressCity}
            onChange={(v) => set("addressCity", v)}
            disabled={pending}
          />
          <Field
            label={t("addressPostalCode")}
            name="addressPostalCode"
            dir="ltr"
            value={values.addressPostalCode}
            onChange={(v) => set("addressPostalCode", v)}
            disabled={pending}
          />
          <Field
            label={t("addressCountry")}
            name="addressCountry"
            dir="ltr"
            value={values.addressCountry}
            onChange={(v) => set("addressCountry", v.toUpperCase().slice(0, 2))}
            disabled={pending}
          />
        </div>
        <Field
          label={t("ilMunicipalAuthority")}
          name="ilMunicipalAuthority"
          value={values.ilMunicipalAuthority}
          onChange={(v) => set("ilMunicipalAuthority", v)}
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
