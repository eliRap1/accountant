"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
} from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import OnboardingProgress from "@/components/app/OnboardingProgress";
import LanguageSwitcher from "@/components/site/ui/LanguageSwitcher";
import { createBusinessAction } from "./actions";

// Three-step wizard: confirm locale → fill business profile → success
// screen. Skipping the "first transaction" step lives downstream in the
// dashboard's empty state (chunk B owns the txn UI).
//
// Form state is kept in plain useState — the spec covers ~10 fields,
// react-hook-form would be overkill. The server action is invoked via
// useTransition so the button can show a spinner without blocking the
// surrounding chrome.

const ENTITY_TYPES = ["patur", "morshe", "hevra_baam", "amuta", "shutfut"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const VAT_STATUSES = [
  "liable",
  "osek_patur",
  "osek_morshe",
  "exporter",
  "nonprofit",
] as const;
type VatStatus = (typeof VAT_STATUSES)[number];

const BOOKKEEPING = ["single_entry", "double_entry"] as const;
type Bookkeeping = (typeof BOOKKEEPING)[number];

// Defaults map entity_type → sensible (vat_status, bookkeeping_method).
// Users can still override before submit.
function defaultsFor(entityType: EntityType): {
  vatStatus: VatStatus;
  bookkeepingMethod: Bookkeeping;
} {
  switch (entityType) {
    case "patur":
      return { vatStatus: "osek_patur", bookkeepingMethod: "single_entry" };
    case "morshe":
      return { vatStatus: "osek_morshe", bookkeepingMethod: "single_entry" };
    case "hevra_baam":
      return { vatStatus: "liable", bookkeepingMethod: "double_entry" };
    case "amuta":
      return { vatStatus: "nonprofit", bookkeepingMethod: "double_entry" };
    case "shutfut":
      return { vatStatus: "liable", bookkeepingMethod: "double_entry" };
  }
}

type Props = { locale: string };

export default function OnboardingWizard({ locale }: Props) {
  const t = useTranslations("app.onboarding");
  const tBusiness = useTranslations("app.onboarding.business");
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, startSubmitting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [vatId, setVatId] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("morshe");
  const [vatStatus, setVatStatus] = useState<VatStatus>("osek_morshe");
  const [bookkeepingMethod, setBookkeepingMethod] =
    useState<Bookkeeping>("single_entry");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");

  function onEntityTypeChange(next: EntityType) {
    setEntityType(next);
    const d = defaultsFor(next);
    setVatStatus(d.vatStatus);
    setBookkeepingMethod(d.bookkeepingMethod);
  }

  function errorMessage(code: string): string {
    // The action returns a zod path key (e.g. "legalName", "vatId") or
    // one of our sentinels. Translate to localised copy where possible.
    if (code === "vatId") return tBusiness("errors.vatIdInvalid");
    if (code === "INSERT_FAILED" || code === "unknown")
      return tBusiness("errors.required");
    return tBusiness("errors.required");
  }

  function onSubmitBusiness(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    fd.set("legalName", legalName);
    fd.set("vatId", vatId);
    fd.set("entityType", entityType);
    fd.set("vatStatus", vatStatus);
    fd.set("bookkeepingMethod", bookkeepingMethod);
    fd.set("addressStreet", addressStreet);
    fd.set("addressCity", addressCity);
    fd.set("addressPostalCode", addressPostalCode);

    startSubmitting(async () => {
      const result = await createBusinessAction(fd);
      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }
      setStep(3);
    });
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong rounded-2xl p-6 sm:p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <div className="mb-6 flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </div>

      <div className="mb-8 mt-4 flex justify-center">
        <OnboardingProgress
          current={step}
          labels={[t("step1"), t("step2"), t("step3")]}
        />
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            key="step-1"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/5 bg-slate-950/40 p-6 text-center">
              <Globe size={24} className="text-emerald-300" />
              <p className="text-sm text-slate-300">{t("step1")}</p>
              <LanguageSwitcher />
              <p className="text-xs text-slate-500" dir="ltr">
                {locale}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
            >
              {tBusiness("submit")}
              <ChevronRight size={16} />
            </button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.form
            key="step-2"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            onSubmit={onSubmitBusiness}
            className="space-y-5"
            noValidate
          >
            <div className="flex items-center gap-2 text-slate-200">
              <Building2 size={16} className="text-emerald-300" />
              <h2 className="text-sm font-semibold tracking-tight">
                {tBusiness("title")}
              </h2>
            </div>

            <Field
              label={tBusiness("legalName")}
              placeholder={tBusiness("legalNamePh")}
              value={legalName}
              onChange={setLegalName}
              required
              disabled={submitting}
              name="legalName"
            />

            <Field
              label={tBusiness("vatId")}
              placeholder={tBusiness("vatIdPh")}
              value={vatId}
              onChange={(v) => setVatId(v.replace(/\D/g, "").slice(0, 9))}
              required
              disabled={submitting}
              name="vatId"
              dir="ltr"
              inputMode="numeric"
            />

            <RadioCards<EntityType>
              label={tBusiness("entityType")}
              value={entityType}
              onChange={onEntityTypeChange}
              options={ENTITY_TYPES.map((v) => ({
                value: v,
                label: tBusiness(`entityType.${v}`),
              }))}
              disabled={submitting}
            />

            <SelectField<VatStatus>
              label={tBusiness("vatStatus")}
              value={vatStatus}
              onChange={setVatStatus}
              options={VAT_STATUSES.map((v) => ({
                value: v,
                label: tBusiness(`vatStatus.${v}`),
              }))}
              disabled={submitting}
            />

            <SelectField<Bookkeeping>
              label={tBusiness("bookkeeping")}
              value={bookkeepingMethod}
              onChange={setBookkeepingMethod}
              options={BOOKKEEPING.map((v) => ({
                value: v,
                label: tBusiness(`bookkeeping.${v}`),
              }))}
              disabled={submitting}
            />

            <fieldset className="space-y-3">
              <legend className="text-sm text-slate-300">
                {tBusiness("address")}
              </legend>
              <Field
                label={tBusiness("addressStreet")}
                value={addressStreet}
                onChange={setAddressStreet}
                disabled={submitting}
                name="addressStreet"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={tBusiness("addressCity")}
                  value={addressCity}
                  onChange={setAddressCity}
                  disabled={submitting}
                  name="addressCity"
                />
                <Field
                  label={tBusiness("addressPostalCode")}
                  value={addressPostalCode}
                  onChange={setAddressPostalCode}
                  disabled={submitting}
                  name="addressPostalCode"
                  dir="ltr"
                  inputMode="numeric"
                />
              </div>
            </fieldset>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
              >
                {error}
              </div>
            )}

            <motion.button
              type="submit"
              disabled={submitting}
              {...(submitting
                ? {}
                : {
                    whileHover: { scale: 1.02, y: -1 },
                    whileTap: { scale: 0.98 },
                  })}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {tBusiness("submit")}
            </motion.button>
          </motion.form>
        )}

        {step === 3 && (
          <motion.div
            key="step-3"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center gap-5 py-6 text-center"
          >
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"
            >
              <CheckCircle2 size={28} />
            </motion.div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                {t("complete.title")}
              </h2>
              <p className="mt-2 text-sm text-slate-400">{t("complete.desc")}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                router.push("/dashboard");
                router.refresh();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
            >
              {t("complete.cta")}
              <ChevronRight size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function Field(props: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
  name: string;
  dir?: "ltr" | "rtl";
  inputMode?: "text" | "numeric" | "email" | "tel";
}) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <input
        name={props.name}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        dir={props.dir}
        inputMode={props.inputMode}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        disabled={props.disabled}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      />
    </label>
  );
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        disabled={props.disabled}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value} className="bg-slate-950">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RadioCards<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-sm text-slate-300">{props.label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {props.options.map((o) => {
          const active = props.value === o.value;
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
                  : "border-white/10 bg-slate-950/40 text-slate-200 hover:bg-white/5"
              } ${props.disabled ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={`radio-${props.label}`}
                value={o.value}
                checked={active}
                onChange={() => props.onChange(o.value)}
                disabled={props.disabled}
                className="sr-only"
              />
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  active ? "bg-emerald-400" : "bg-slate-600"
                }`}
              />
              <span className="flex-1">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
