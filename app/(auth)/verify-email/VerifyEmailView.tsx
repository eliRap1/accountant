"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, Loader2, Check } from "lucide-react";
import { sendVerificationEmail } from "@/lib/auth/client";

export default function VerifyEmailView() {
  const searchParams = useSearchParams();
  const email = searchParams?.get("email") ?? "";

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onResend() {
    if (!email) {
      setError("חסרה כתובת אימייל לשליחה חוזרת");
      return;
    }
    setResending(true);
    setError(null);
    try {
      const result = await sendVerificationEmail({
        email,
        callbackURL: "/post-auth",
      });
      if (result.error) {
        setError(result.error.message ?? "שליחה חוזרת נכשלה");
        return;
      }
      setResent(true);
      window.setTimeout(() => setResent(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setResending(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong rounded-2xl p-8 text-center shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
        <Mail size={24} />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-100">
        בדקו את האימייל שלכם
      </h1>
      <p className="mt-3 text-sm text-slate-400">
        שלחנו קישור אימות לכתובת
        {email && (
          <>
            {" "}
            <span dir="ltr" className="font-mono text-slate-200">
              {email}
            </span>
          </>
        )}
        . לחצו עליו כדי להמשיך.
      </p>

      <div className="mt-8 space-y-3">
        <motion.button
          type="button"
          onClick={onResend}
          disabled={resending || resent || !email}
          {...(resending || resent
            ? {}
            : {
                whileHover: { scale: 1.02, y: -1 },
                whileTap: { scale: 0.98 },
              })}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/5 px-5 py-3 text-sm font-medium tracking-tight text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {resending && <Loader2 size={16} className="animate-spin" />}
          {resent && <Check size={16} />}
          {resending
            ? "שולח..."
            : resent
              ? "נשלח! בדקו את התיבה"
              : "שליחה חוזרת של הקישור"}
        </motion.button>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          >
            {error}
          </div>
        )}
      </div>

      <div className="mt-8 border-t border-white/10 pt-6 text-xs text-slate-500">
        לא קיבלתם? בדקו תיקיית ספאם, או{" "}
        <Link
          href={"/sign-in" as Route}
          className="text-emerald-300 hover:text-emerald-200"
        >
          התחברו עם חשבון קיים
        </Link>
      </div>
    </motion.section>
  );
}
