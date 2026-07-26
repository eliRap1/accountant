"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Loader2, KeyRound } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { resetPassword } from "@/lib/auth/client";

export default function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError(t("errors.missingToken"));
      return;
    }
    if (password !== confirm) {
      setError(t("errors.mismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("errors.passwordTooShortClient"));
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(t(messageKeyFor(result.error.code)));
        return;
      }
      router.push({ pathname: "/sign-in", query: { reset: "ok" } });
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <KeyRound size={18} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("title")}
        </h1>
      </div>
      <p className="mt-3 text-sm text-slate-400">{t("subtitle")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <label className="block">
          <span className="block text-sm text-slate-300">{t("passwordLabel")}</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-slate-300">
            {t("passwordConfirmLabel")}
          </span>
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            dir="ltr"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={submitting}
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
          />
        </label>

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
        <Link
          href="/sign-in"
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          {t("backToSignIn")}
        </Link>
      </p>
    </motion.section>
  );
}

// Map Better Auth error codes to translation keys (relative to the
// `auth.resetPassword` namespace).
function messageKeyFor(code: string | undefined): string {
  switch (code) {
    case "INVALID_TOKEN":
      return "errors.invalidToken";
    case "TOKEN_EXPIRED":
      return "errors.tokenExpired";
    case "PASSWORD_TOO_SHORT":
      return "errors.passwordTooShort";
    case "PASSWORD_TOO_LONG":
      return "errors.passwordTooLong";
    default:
      return "errors.generic";
  }
}
