"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, KeyRound } from "lucide-react";
import { resetPassword } from "@/lib/auth/client";

export default function ResetPasswordForm() {
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
      setError("הקישור לא תקף — חסר token");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    if (password.length < 12) {
      setError("סיסמה חייבת לכלול לפחות 12 תווים");
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        return;
      }
      router.push("/sign-in?reset=ok" as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
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
          סיסמה חדשה
        </h1>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        בחרו סיסמה חדשה (לפחות 12 תווים).
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <label className="block">
          <span className="block text-sm text-slate-300">סיסמה חדשה</span>
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
          <span className="block text-sm text-slate-300">אימות סיסמה</span>
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
          {submitting ? "שומר..." : "עדכן סיסמה"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        <Link
          href={"/sign-in" as Route}
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          חזרה לכניסה
        </Link>
      </p>
    </motion.section>
  );
}

function messageFor(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "הקישור לאיפוס פג תוקף — בקשו קישור חדש";
    case "PASSWORD_TOO_SHORT":
      return "הסיסמה קצרה מדי (מינימום 12 תווים)";
    case "PASSWORD_TOO_LONG":
      return "הסיסמה ארוכה מדי (מקסימום 128 תווים)";
    default:
      return fallback ?? "שגיאה באיפוס סיסמה";
  }
}
