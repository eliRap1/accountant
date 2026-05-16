"use client";

import { useState, useTransition, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  Field,
  SelectField,
  TextareaField,
  ErrorBanner,
} from "@/components/app/ui/Field";
import { createClient, updateClient } from "./actions";

export type ClientFormValues = {
  id?: string;
  businessId: string;
  legalName: string;
  vatId: string;
  email: string;
  phone: string;
  notes: string;
  addressStreet: string;
  addressCity: string;
  addressPostalCode: string;
  addressCountry: string;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
};

export type BusinessOption = { id: string; legalName: string };

type Props = {
  mode: "new" | "edit";
  businesses: ReadonlyArray<BusinessOption>;
  initial?: Partial<ClientFormValues>;
};

const CURRENCY_OPTIONS = [
  { value: "ILS", label: "ILS" },
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
] as const;

export default function ClientForm({ mode, businesses, initial }: Props) {
  const t = useTranslations("app.clients");
  const tCommon = useTranslations("app.common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const defaultBusinessId =
    initial?.businessId ??
    (businesses.length === 1 ? (businesses[0]?.id ?? "") : "");

  const [values, setValues] = useState<ClientFormValues>({
    businessId: defaultBusinessId,
    legalName: initial?.legalName ?? "",
    vatId: initial?.vatId ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    notes: initial?.notes ?? "",
    addressStreet: initial?.addressStreet ?? "",
    addressCity: initial?.addressCity ?? "",
    addressPostalCode: initial?.addressPostalCode ?? "",
    addressCountry: initial?.addressCountry ?? "IL",
    defaultPaymentTermsDays: initial?.defaultPaymentTermsDays ?? 14,
    defaultCurrency: initial?.defaultCurrency ?? "ILS",
    ...(initial?.id !== undefined ? { id: initial.id } : {}),
  });

  function set<K extends keyof ClientFormValues>(
    key: K,
    v: ClientFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: v }));
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
    fd.set("legalName", values.legalName);
    fd.set("vatId", values.vatId);
    fd.set("email", values.email);
    fd.set("phone", values.phone);
    fd.set("notes", values.notes);
    fd.set("addressStreet", values.addressStreet);
    fd.set("addressCity", values.addressCity);
    fd.set("addressPostalCode", values.addressPostalCode);
    fd.set("addressCountry", values.addressCountry);
    fd.set(
      "defaultPaymentTermsDays",
      String(values.defaultPaymentTermsDays),
    );
    fd.set("defaultCurrency", values.defaultCurrency);

    startTransition(async () => {
      const result =
        mode === "new" ? await createClient(fd) : await updateClient(fd);
      if (result && "error" in result) {
        setError(translateError(result.error, tCommon));
        return;
      }
      if (result && "ok" in result) {
        router.push(`/clients/${result.id}`);
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
          disabled={pending}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label={t("email")}
            name="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            value={values.email}
            onChange={(v) => set("email", v)}
            help={t("encryptedHelp")}
            disabled={pending}
          />
          <Field
            label={t("phone")}
            name="phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(v) => set("phone", v)}
            help={t("encryptedHelp")}
            disabled={pending}
          />
        </div>

        <TextareaField
          label={t("notes")}
          name="notes"
          value={values.notes}
          onChange={(v) => set("notes", v)}
          rows={3}
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

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label={t("defaultPaymentTermsDays")}
            name="defaultPaymentTermsDays"
            type="number"
            dir="ltr"
            inputMode="numeric"
            min={0}
            max={365}
            value={String(values.defaultPaymentTermsDays)}
            onChange={(v) =>
              set("defaultPaymentTermsDays", Number(v) || 0)
            }
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
): string {
  switch (code) {
    case "app.errors.invalidInput":
      return tCommon("invalidInput");
    default:
      return code;
  }
}
