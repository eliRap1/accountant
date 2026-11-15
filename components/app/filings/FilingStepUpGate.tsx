"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ShieldAlert } from "lucide-react";

// Step-up presenter for filing-export actions.
//
// Real step-up enrollment lives in /api/auth/step-up + a 2FA modal we
// don't own here. This component is the LAST-MILE UX that surfaces a
// translated banner + a refresh affordance when an API/server-action
// has just returned `app.filings.errors.stepUpRequired`. Once the
// operator completes step-up elsewhere (e.g. by re-entering their TOTP
// code on the dedicated screen), they come back and retry — the gate
// disappears because the grant is fresh.
//
// The component does NOT itself perform the step-up handshake; instead
// it lets the calling surface trigger the standard auth flow by
// router.refresh()-ing after a navigation to /sign-in?step-up=1 (the
// caller wires the redirect — kept out of this gate so the gate is
// generator-agnostic).

export type FilingStepUpGateProps = {
  /** When true, the gate renders. Reset to false after the caller
   *  successfully obtains a fresh grant. */
  required: boolean;
  /** Step-up op symbol (e.g. `filing.export_pcn874`). Surfaced for the
   *  audit/UX strings so the operator knows what's being unlocked. */
  op?: string;
  /** Optional payload hash — opaque; only forwarded to the auth modal. */
  payloadHash?: string;
  /** Click handler for the "try again" CTA. Defaults to router.refresh. */
  onRetry?: () => void;
  /** Free-form extra content rendered below the message. */
  children?: ReactNode;
};

export default function FilingStepUpGate({
  required,
  op,
  payloadHash,
  onRetry,
  children,
}: FilingStepUpGateProps): ReactNode {
  const t = useTranslations("app.filings");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (!required) return null;

  function handleRetry() {
    if (onRetry) {
      onRetry();
      return;
    }
    setPending(true);
    router.refresh();
    // The component will re-render with `required={false}` once the
    // caller's server data shows a fresh grant. Reset the spinner if it
    // sticks around for more than a second.
    setTimeout(() => setPending(false), 1000);
  }

  return (
    <div
      role="alert"
      className="glass rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          size={18}
          className="mt-0.5 shrink-0 text-amber-300"
          aria-hidden
        />
        <div className="flex-1 space-y-2">
          <p className="font-medium">{t("errors.stepUpRequired")}</p>
          {op ? (
            <p className="text-xs text-amber-200/70" dir="ltr">
              op: {op}
              {payloadHash ? ` · payload: ${payloadHash.slice(0, 12)}…` : ""}
            </p>
          ) : null}
          {children}
          <button
            type="button"
            onClick={handleRetry}
            disabled={pending}
            className="mt-1 inline-flex items-center rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-500/15 disabled:opacity-60"
          >
            {pending ? "..." : t("detail.downloadCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
