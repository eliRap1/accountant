"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { signIn } from "@/lib/auth/client";

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
        ברוכים השבים
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        הזינו את פרטי החשבון שלכם להמשך
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
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
          label="סיסמה"
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
            href={"/forgot-password" as Route}
            className="text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            שכחת סיסמה?
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
          {submitting ? "מתחבר..." : "התחבר"}
        </motion.button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        אין לכם חשבון?{" "}
        <Link
          href={"/sign-up" as Route}
          className="text-emerald-300 hover:text-emerald-200 transition-colors"
        >
          צור חשבון
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
    case "INVALID_EMAIL_OR_PASSWORD":
      return "אימייל או סיסמה שגויים";
    case "EMAIL_NOT_VERIFIED":
      return "האימייל לא אומת — בדקו את תיבת הדואר שלכם";
    case "USER_BANNED":
      return "החשבון הזה הושעה";
    case "TOO_MANY_ATTEMPTS":
      return "יותר מדי ניסיונות — נסו שוב בעוד מספר דקות";
    default:
      return fallback ?? "שגיאה בהתחברות";
  }
}
