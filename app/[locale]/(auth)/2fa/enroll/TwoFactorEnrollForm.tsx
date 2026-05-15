"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck, Copy, Check } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { twoFactor } from "@/lib/auth/client";

type EnrollState =
  | { kind: "password" }
  | {
      kind: "scan";
      totpURI: string;
      backupCodes: string[];
    };

export default function TwoFactorEnrollForm() {
  const router = useRouter();

  const [state, setState] = useState<EnrollState>({ kind: "password" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);

  async function onEnable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await twoFactor.enable({
        password,
        issuer: "AccounTech",
      });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        return;
      }
      const data = result.data;
      if (!data?.totpURI) {
        setError("חסר URI לאימות — נסו שוב");
        return;
      }
      setState({
        kind: "scan",
        totpURI: data.totpURI,
        backupCodes: data.backupCodes ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await twoFactor.verifyTotp({ code: code.trim() });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        return;
      }
      router.push({
        pathname: "/recovery-codes",
        query: { source: "enroll" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setSubmitting(false);
    }
  }

  function copy(value: string, kind: "secret" | "codes") {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    });
  }

  if (state.kind === "password") {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <ShieldCheck size={18} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            הפעלת אימות דו-שלבי
          </h1>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          הזינו את הסיסמה הנוכחית כדי לאשר את הפעלת ה-2FA.
        </p>

        <form onSubmit={onEnable} className="mt-8 space-y-5" noValidate>
          <label className="block">
            <span className="block text-sm text-slate-300">סיסמה נוכחית</span>
            <input
              type="password"
              name="password"
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
            {submitting ? "מאמת..." : "המשך"}
          </motion.button>
        </form>
      </motion.section>
    );
  }

  // Extract secret from otpauth URI — the `secret` query param is the
  // base32 string the user types into apps that don't support QR-import.
  const totpSecret = extractSecret(state.totpURI);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="glass-strong rounded-2xl p-8 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.35)]"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        סריקה ואימות
      </h1>
      <p className="mt-3 text-sm text-slate-400">
        הוסיפו את החשבון לאפליקציית מאמת (Google Authenticator, Authy, 1Password).
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">
            קוד סודי (להזנה ידנית)
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code
              dir="ltr"
              className="flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2.5 font-mono text-sm tracking-widest text-emerald-300"
            >
              {totpSecret}
            </code>
            <button
              type="button"
              onClick={() => copy(totpSecret, "secret")}
              className="rounded-lg border border-white/10 bg-slate-950/60 p-2.5 text-slate-300 transition-colors hover:bg-slate-900"
              aria-label="העתקה"
            >
              {copied === "secret" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">
            או פתיחה ישירה
          </p>
          <a
            href={state.totpURI}
            className="mt-2 block truncate rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 font-mono text-xs text-emerald-300 hover:bg-slate-900"
            dir="ltr"
          >
            {state.totpURI}
          </a>
        </div>

        {state.backupCodes.length > 0 && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-200">
              קודי שחזור — שמרו במקום בטוח
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              כל קוד חד-פעמי. שמשו רק במקרה שאיבדתם גישה למאמת.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-xs text-amber-100" dir="ltr">
              {state.backupCodes.map((c) => (
                <span key={c} className="rounded bg-amber-500/10 px-2 py-1">
                  {c}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => copy(state.backupCodes.join("\n"), "codes")}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200"
            >
              {copied === "codes" ? <Check size={14} /> : <Copy size={14} />}
              {copied === "codes" ? "הועתק" : "העתקת כל הקודים"}
            </button>
          </div>
        )}
      </div>

      <form onSubmit={onVerify} className="mt-8 space-y-5" noValidate>
        <label className="block">
          <span className="block text-sm text-slate-300">
            הזינו את הקוד מהמאמת לאישור
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            disabled={submitting}
            className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
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
          disabled={submitting || code.length !== 6}
          {...(submitting || code.length !== 6
            ? {}
            : {
                whileHover: { scale: 1.02, y: -1 },
                whileTap: { scale: 0.98 },
              })}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          {submitting ? "מאמת..." : "אימות והפעלה"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        <a
          href="/post-auth"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          דילוג להמשך
        </a>
      </p>
    </motion.section>
  );
}

function extractSecret(uri: string): string {
  try {
    const url = new URL(uri);
    return url.searchParams.get("secret") ?? uri;
  } catch {
    return uri;
  }
}

function messageFor(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "INVALID_PASSWORD":
    case "INVALID_EMAIL_OR_PASSWORD":
      return "סיסמה שגויה";
    case "INVALID_CODE":
      return "קוד שגוי — בדקו את אפליקציית המאמת";
    case "TWO_FACTOR_NOT_ENABLED":
      return "אימות דו-שלבי לא מאופשר עדיין";
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "יותר מדי ניסיונות — נסו שוב בעוד מספר דקות";
    default:
      return fallback ?? "שגיאה באימות דו-שלבי";
  }
}
