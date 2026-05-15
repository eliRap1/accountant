"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck } from "lucide-react";
import { twoFactor } from "@/lib/auth/client";

// Reached after sign-in when the user has 2FA enabled. The Better Auth
// session is held in a pending state until the TOTP (or backup-code)
// challenge passes.
export default function TwoFactorVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get("redirect") ?? "/post-auth";

  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result =
        mode === "totp"
          ? await twoFactor.verifyTotp({ code: code.trim(), trustDevice })
          : await twoFactor.verifyBackupCode({ code: code.trim() });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        return;
      }
      router.push(redirectTo as Route);
      router.refresh();
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
          <ShieldCheck size={18} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          אימות דו-שלבי
        </h1>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        {mode === "totp"
          ? "הזינו את הקוד מאפליקציית המאמת שלכם."
          : "הזינו אחד מקודי השחזור (8 ספרות)."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <label className="block">
          <span className="block text-sm text-slate-300">
            {mode === "totp" ? "קוד 6 ספרות" : "קוד שחזור"}
          </span>
          <input
            type="text"
            inputMode={mode === "totp" ? "numeric" : "text"}
            pattern={mode === "totp" ? "[0-9]{6}" : undefined}
            maxLength={mode === "totp" ? 6 : 16}
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            onChange={(e) =>
              setCode(
                mode === "totp"
                  ? e.target.value.replace(/\D/g, "")
                  : e.target.value.toUpperCase(),
              )
            }
            required
            disabled={submitting}
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-center font-mono text-lg tracking-[0.3em] text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
          />
        </label>

        {mode === "totp" && (
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-950/60 text-emerald-500 focus:ring-emerald-500/40"
            />
            <span>סמכו על המכשיר הזה ל-30 ימים</span>
          </label>
        )}

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
          disabled={submitting || code.length < (mode === "totp" ? 6 : 4)}
          {...(submitting || code.length < (mode === "totp" ? 6 : 4)
            ? {}
            : {
                whileHover: { scale: 1.02, y: -1 },
                whileTap: { scale: 0.98 },
              })}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? "מאמת..." : "אמת והמשך"}
        </motion.button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "totp" ? "backup" : "totp");
            setCode("");
            setError(null);
          }}
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          {mode === "totp"
            ? "שימוש בקוד שחזור במקום"
            : "חזרה לאפליקציית המאמת"}
        </button>
        <Link
          href={"/sign-in" as Route}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          התחברות עם חשבון אחר
        </Link>
      </div>
    </motion.section>
  );
}

function messageFor(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "INVALID_CODE":
      return "קוד שגוי";
    case "INVALID_BACKUP_CODE":
      return "קוד שחזור שגוי או שכבר נוצל";
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "יותר מדי ניסיונות — נסו שוב בעוד מספר דקות";
    case "INVALID_TWO_FACTOR_COOKIE":
      return "התחברו מחדש לפני אימות 2FA";
    default:
      return fallback ?? "שגיאה באימות";
  }
}
