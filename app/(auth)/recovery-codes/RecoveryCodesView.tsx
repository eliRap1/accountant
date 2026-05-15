"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, ShieldAlert, Copy, Check } from "lucide-react";
import { twoFactor } from "@/lib/auth/client";

// Two modes:
//   ?source=enroll  — user just enabled 2FA; show the codes they should
//                     write down. Better Auth already returned them on
//                     /two-factor/enable, but if we lost that response
//                     this page can regenerate.
//   default         — manual regenerate flow gated by current password.
export default function RecoveryCodesView() {
  const searchParams = useSearchParams();
  const isPostEnroll = searchParams?.get("source") === "enroll";

  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await twoFactor.generateBackupCodes({ password });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        return;
      }
      setCodes(result.data?.backupCodes ?? []);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setSubmitting(false);
    }
  }

  function copyAll() {
    if (!codes) return;
    navigator.clipboard.writeText(codes.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          <ShieldAlert size={18} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          קודי שחזור
        </h1>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        {isPostEnroll
          ? "הקודים הבאים מאפשרים גישה אם תאבדו את אפליקציית המאמת. כל קוד חד-פעמי."
          : "הקודים הישנים יבוטלו לאחר היצירה — שמרו את הקודים החדשים."}
      </p>

      {codes ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-2 rounded-lg border border-amber-400/40 bg-amber-500/5 p-4 font-mono text-sm text-amber-100" dir="ltr">
            {codes.map((c) => (
              <span key={c} className="rounded bg-amber-500/10 px-2 py-1.5 text-center tracking-wider">
                {c}
              </span>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={copyAll}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/5 px-5 py-3 text-sm font-medium tracking-tight text-emerald-200 transition-colors hover:bg-emerald-500/10"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "הועתק" : "העתקת כל הקודים"}
            </button>
            <Link
              href={"/post-auth" as Route}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
            >
              סיימתי לשמור — המשך
            </Link>
          </div>
        </>
      ) : (
        <form onSubmit={onGenerate} className="mt-8 space-y-5" noValidate>
          <label className="block">
            <span className="block text-sm text-slate-300">סיסמה נוכחית</span>
            <input
              type="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {submitting ? "יוצר..." : "יצירת קודים חדשים"}
          </motion.button>
        </form>
      )}
    </motion.section>
  );
}

function messageFor(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "INVALID_PASSWORD":
    case "INVALID_EMAIL_OR_PASSWORD":
      return "סיסמה שגויה";
    case "TWO_FACTOR_NOT_ENABLED":
      return "אימות דו-שלבי לא מאופשר עדיין";
    default:
      return fallback ?? "שגיאה ביצירת קודים";
  }
}
