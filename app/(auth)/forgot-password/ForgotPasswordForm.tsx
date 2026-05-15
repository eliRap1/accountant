"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { motion } from "framer-motion";
import { Loader2, Check, KeyRound } from "lucide-react";
import { requestPasswordReset } from "@/lib/auth/client";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // We always show the same success view whether the email exists or not —
  // never confirm user existence on the forgot-password endpoint.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      if (result.error && result.error.code !== "USER_NOT_FOUND") {
        setError(result.error.message ?? "שגיאה בשליחת קישור איפוס");
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="glass-strong rounded-2xl p-8 text-center shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <Check size={24} />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-100">
          בדקו את האימייל שלכם
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          אם הכתובת רשומה אצלנו, שלחנו אליה קישור לאיפוס סיסמה. תוקף הקישור — שעה אחת.
        </p>
        <Link
          href={"/sign-in" as Route}
          className="mt-8 inline-block text-sm text-emerald-300 hover:text-emerald-200"
        >
          חזרה לכניסה
        </Link>
      </motion.section>
    );
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            איפוס סיסמה
          </h1>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        הזינו את כתובת האימייל ונשלח לכם קישור לאיפוס סיסמה.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <label className="block">
          <span className="block text-sm text-slate-300">כתובת אימייל</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
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
          {submitting ? "שולח..." : "שליחת קישור איפוס"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        נזכרתם בסיסמה?{" "}
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
