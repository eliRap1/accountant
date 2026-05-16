"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Building2, Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { createBusinessAction } from "./actions";

// Single-step business profile wizard.
//
// Council Q5 cut the onboarding from 10 steps → 2:
//   Step 1 — /sign-up (name, email, password, ToS, captcha)
//   Step 2 — this page (legalName, vatId, entityType, city)
//
// vat_status + bookkeeping_method are no longer pickers — they're
// derived deterministically from entity_type via `defaultsFor()`
// (see `lib/onboarding/defaults.ts`). The user can still change them
// from /settings if they need to.
//
// On submit we redirect to /dashboard — there is no "success splash"
// step (Product council § 2 cut #5: "collapse the success splash into
// a toast on /dashboard").

const ENTITY_TYPES = ["patur", "morshe", "hevra_baam"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

type Props = { locale: string };

export default function OnboardingWizard({ locale }: Props) {
  // `locale` is consumed by the parent page for metadata; keep it in
  // the props signature so the component contract stays stable.
  void locale;
  const t = useTranslations("app.onboarding");
  const tBusiness = useTranslations("app.onboarding.business");
  const router = useRouter();

  const [submitting, startSubmitting] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [vatId, setVatId] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("morshe");
  const [city, setCity] = useState("");

  function errorMessage(code: string): string {
    if (code === "vatId") return tBusiness("errors.vatIdInvalid");
    return tBusiness("errors.required");
  }

  function onSubmitBusiness(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    fd.set("legalName", legalName);
    fd.set("vatId", vatId);
    fd.set("entityType", entityType);
    fd.set("addressCity", city);

    startSubmitting(async () => {
      const result = await createBusinessAction(fd);
      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }
      router.push("/dashboard");
      router.refresh();
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

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
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
          onChange={setEntityType}
          options={ENTITY_TYPES.map((v) => ({
            value: v,
            label: tBusiness(`entityType.${v}`),
            sub: tBusiness(`entityType.${v}Hint`),
          }))}
          disabled={submitting}
        />

        <Field
          label={tBusiness("addressCity")}
          value={city}
          onChange={setCity}
          disabled={submitting}
          name="addressCity"
        />

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

function RadioCards<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; sub?: string }>;
  disabled?: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-sm text-slate-300">{props.label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {props.options.map((o) => {
          const active = props.value === o.value;
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-3 text-sm transition-colors ${
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
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    active ? "bg-emerald-400" : "bg-slate-600"
                  }`}
                />
                <span className="font-medium">{o.label}</span>
              </div>
              {o.sub ? (
                <span className="text-xs text-slate-400">{o.sub}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
