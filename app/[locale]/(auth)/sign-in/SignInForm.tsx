"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { signIn } from "@/lib/auth/client";

export default function SignInForm() {
  const t = useTranslations("auth.signIn");
  const router = useRouter();
  const searchParams = useSearchParams();
  // `redirect` is a relative path inside the [locale] tree; next-intl
  // router auto-prefixes the active locale. `/post-auth` is the root-level
  // bridge — for that we fall back to a full-page nav so the prefix
  // logic doesn't kick in.
  const redirectTo = searchParams?.get("redirect") ?? "/post-auth";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.email({
        email: email.trim(),
        password,
        rememberMe: true,
      });
      if (result.error) {
        setError(t(messageKeyFor(result.error.code)));
        return;
      }
      if (redirectTo.startsWith("/post-auth")) {
        window.location.assign(redirectTo);
      } else {
        router.push(redirectTo);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpected"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        {t("title")}
      </h1>
      <p className="mt-2 text-sm text-slate-400">{t("subtitle")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <Field
          label={t("emailLabel")}
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          onChange={setEmail}
          required
          disabled={submitting}
        />
        <Field
          label={t("passwordLabel")}
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={setPassword}
          required
          disabled={submitting}
        />

        <div className="flex items-center justify-between text-xs">
          <Link
            href="/forgot-password"
            className="text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            {t("forgotPassword")}
          </Link>
        </div>

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
          {submitting ? t("submitting") : t("submit")}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        {t("noAccount")}{" "}
        <Link
          href="/sign-up"
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          {t("createOne")}
        </Link>
      </p>
    </motion.section>
  );
}

function Field(props: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  dir?: "ltr" | "rtl";
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-300">{props.label}</span>
      <input
        name={props.name}
        type={props.type}
        autoComplete={props.autoComplete}
        dir={props.dir}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        disabled={props.disabled}
        className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
      />
    </label>
  );
}

// Map Better Auth error codes to translation keys (relative to the
// `auth.signIn` namespace). `t(key)` is called at render time so the
// active locale is picked up — Better Auth doesn't speak our locales.
function messageKeyFor(code: string | undefined): string {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "errors.invalidCredentials";
    case "EMAIL_NOT_VERIFIED":
      return "errors.emailNotVerified";
    case "USER_BANNED":
      return "errors.userBanned";
    case "TOO_MANY_ATTEMPTS":
      return "errors.tooManyAttempts";
    default:
      return "errors.generic";
  }
}
