"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { signUp } from "@/lib/auth/client";

// Cloudflare Turnstile global (loaded via <script> in useEffect).
declare global {
  interface Window {
    turnstile?: {
      render: (
        target: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          language?: string;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Props = { turnstileSiteKey: string };

export default function SignUpForm({ turnstileSiteKey }: Props) {
  const router = useRouter();
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const fieldId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey || typeof window === "undefined") return;

    function renderWidget() {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current)
        return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
        theme: "dark",
        language: "he",
      });
    }

    if (!document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)) {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      renderWidget();
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [turnstileSiteKey]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    if (password.length < 12) {
      setError("סיסמה חייבת לכלול לפחות 12 תווים");
      return;
    }
    if (!acceptedTerms) {
      setError("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
      return;
    }
    if (turnstileSiteKey && !captchaToken) {
      setError("יש להשלים את אימות ה-CAPTCHA");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
        ...(captchaToken
          ? { fetchOptions: { headers: { "x-captcha-response": captchaToken } } }
          : {}),
      });
      if (result.error) {
        setError(messageFor(result.error.code, result.error.message));
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
          setCaptchaToken(null);
        }
        return;
      }
      router.push(
        `/verify-email?email=${encodeURIComponent(email.trim())}` as Route,
      );
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        פתיחת חשבון
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        רישום לחשבון AccounTech לעצמאים ובעלי עסקים בישראל
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <Field
          label="שם מלא"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={setName}
          required
          disabled={submitting}
        />
        <Field
          label="כתובת אימייל"
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
          label="סיסמה (מינימום 12 תווים)"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={setPassword}
          required
          disabled={submitting}
        />
        <Field
          label="אימות סיסמה"
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          required
          disabled={submitting}
        />

        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input
            id={`${fieldId}-terms`}
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-950/60 text-emerald-500 focus:ring-emerald-500/40"
          />
          <span>
            אני מאשר/ת את{" "}
            <Link
              href={"/terms" as Route}
              className="text-emerald-300 hover:text-emerald-200"
            >
              תנאי השימוש
            </Link>{" "}
            ואת{" "}
            <Link
              href={"/privacy" as Route}
              className="text-emerald-300 hover:text-emerald-200"
            >
              מדיניות הפרטיות
            </Link>
          </span>
        </label>

        {turnstileSiteKey && (
          <div ref={turnstileRef} className="cf-turnstile-container" dir="ltr" />
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
          {submitting ? "יוצר חשבון..." : "צור חשבון"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        כבר יש לכם חשבון?{" "}
        <Link
          href={"/sign-in" as Route}
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          התחברו
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

function messageFor(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "USER_ALREADY_EXISTS":
      return "כתובת האימייל הזו כבר רשומה — נסו להתחבר";
    case "PASSWORD_TOO_SHORT":
      return "הסיסמה קצרה מדי (מינימום 12 תווים)";
    case "PASSWORD_TOO_LONG":
      return "הסיסמה ארוכה מדי (מקסימום 128 תווים)";
    case "INVALID_EMAIL":
      return "כתובת אימייל לא חוקית";
    case "CAPTCHA_FAILED":
    case "INVALID_CAPTCHA_TOKEN":
      return "אימות CAPTCHA נכשל — נסו שוב";
    case "TOO_MANY_ATTEMPTS":
      return "יותר מדי ניסיונות — נסו שוב בעוד מספר דקות";
    default:
      return fallback ?? "שגיאה ביצירת חשבון";
  }
}
