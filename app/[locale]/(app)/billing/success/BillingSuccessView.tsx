"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "@/i18n/navigation";

type Status = {
  planId: string;
  status: string;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

// Webhook activation isn't guaranteed before the user reaches /success
// — Stripe's CDN return + our webhook are independent network paths.
// Poll the status endpoint for a short window so the UI never shows
// "still on free" when the user has already paid.
const POLL_INTERVAL_MS = 1200;
const MAX_POLL_ATTEMPTS = 8;

export default function BillingSuccessView({ locale: _locale }: { locale: string }) {
  void _locale;
  const t = useTranslations("app.billing.success");
  const [status, setStatus] = useState<Status | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [stillPolling, setStillPolling] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch("/api/billing/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as Status;
          if (!active) return;
          setStatus(data);
          if (data.status === "active" || data.status === "trialing") {
            setStillPolling(false);
            return;
          }
        }
      } catch {
        // ignore — we'll retry below
      }
      setAttempts((n) => n + 1);
    };

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(async () => {
        await poll();
        if (!active) return;
        if (attempts < MAX_POLL_ATTEMPTS && stillPolling) schedule();
        else setStillPolling(false);
      }, POLL_INTERVAL_MS);
    };

    // First call immediately, then schedule.
    poll().then(() => {
      if (!active) return;
      schedule();
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = status?.status === "active" || status?.status === "trialing";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-12 text-center">
      {active ? (
        <CheckCircle2 className="size-12 text-emerald-300" />
      ) : (
        <Loader2 className="size-10 animate-spin text-emerald-300" />
      )}
      <h1 className="text-2xl font-semibold text-slate-100">
        {active ? t("title") : t("pending.title")}
      </h1>
      <p className="text-sm text-slate-400">
        {active ? t("desc") : t("pending.desc")}
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/billing"
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
        >
          {t("backToBilling")}
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
        >
          {t("toDashboard")}
        </Link>
      </div>
    </div>
  );
}
