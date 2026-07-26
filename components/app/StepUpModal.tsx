"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ShieldCheck, X } from "lucide-react";

// Generic step-up modal. Server actions return
//   { stepUpRequired: { op, payloadHash } }
// when a sensitive op needs a fresh proof. The form that triggered
// the action can wrap its outer state in this modal: when the
// envelope arrives, render the modal, collect the factor, POST to
// `/api/auth/step-up`, and on 200 re-run the original action.
//
// The modal is intentionally minimal — password only, TOTP / passkey
// require a separate flow that loads the Better Auth client SDK.
// Phase F.5 expands the factor menu; this stop-gap unblocks the
// invoice-issue / filing-export / mfa-disable / passkey-delete paths.

export type StepUpEnvelope = {
  op: string;
  payloadHash: string;
};

type Props = {
  envelope: StepUpEnvelope | null;
  onClose: () => void;
  onGranted: () => void;
};

export default function StepUpModal({ envelope, onClose, onGranted }: Props) {
  const t = useTranslations("app.stepUp");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save previously-focused element on open; restore on close.
  useEffect(() => {
    if (envelope) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [envelope]);

  // Focus trap + Escape handler.
  useEffect(() => {
    if (!envelope) return;
    const panel = panelRef.current;
    if (!panel) return;

    function getFocusable(): HTMLElement[] {
      return Array.from(
        panel!.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.closest("[disabled]"));
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [envelope, onClose]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!envelope) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: envelope.op,
          payloadHash: envelope.payloadHash,
          factor: "password",
          credential: password,
        }),
      });
      if (res.status === 200) {
        setPassword("");
        onGranted();
        return;
      }
      if (res.status === 401) {
        setError(t("errors.wrongFactor"));
        return;
      }
      setError(t("errors.unknown"));
    } catch {
      setError(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {envelope ? (
        <motion.div
          key="step-up-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-up-title"
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong w-full max-w-md rounded-2xl p-6 shadow-[0_30px_80px_-30px_rgba(16,185,129,0.45)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-emerald-500/15 p-2 text-emerald-300">
                  <ShieldCheck size={16} />
                </span>
                <div className="flex flex-col">
                  <h2
                    id="step-up-title"
                    className="text-base font-semibold tracking-tight text-slate-100"
                  >
                    {t("title")}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {t("subtitle", { op: envelope.op })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/5"
                aria-label={t("close")}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
              <label className="block">
                <span className="block text-sm text-slate-300">
                  {t("passwordLabel")}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  disabled={submitting}
                  dir="ltr"
                  className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                />
              </label>

              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                >
                  {error}
                </div>
              ) : null}

              {/* flex-row-reverse places Confirm first in DOM/visual order (inline-end
                  in LTR). rtl:flex-row restores natural order in RTL so Confirm stays
                  on the inline-end (left) — matching platform convention in both dirs. */}
              <div className="flex flex-row-reverse items-center justify-start gap-2 rtl:flex-row">
                <button
                  type="submit"
                  disabled={submitting || password.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
