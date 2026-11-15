"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";

type PlanSummary = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingInterval: string;
};

type CurrentSubscription = {
  planId: string;
  status: string;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type Props = {
  locale: string;
  plans: PlanSummary[];
  knownPlanIds: string[];
  current: CurrentSubscription;
};

function formatMinor(minor: number, currency: string): string {
  // Plans are stored VAT-INCLUSIVE in agorot. Display as "₪49 / month"
  // for ILS, otherwise fall back to Intl currency formatting.
  const major = minor / 100;
  if (currency === "ILS") {
    if (major === 0) return "₪0";
    if (Number.isInteger(major)) return `₪${major}`;
    return `₪${major.toFixed(2)}`;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${major} ${currency}`;
  }
}

// Whitelist of known status/interval keys we ship translations for.
// Anything not in the list falls back to the raw enum value rather than
// throwing through next-intl's strict missing-key check.
const KNOWN_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "cancelled",
  "expired",
  "none",
]);
const KNOWN_INTERVALS = new Set(["month", "year"]);

export default function BillingView({
  locale,
  plans,
  knownPlanIds,
  current,
}: Props) {
  const t = useTranslations("app.billing");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = KNOWN_STATUSES.has(current.status)
    ? t(`status.${current.status}` as "status.active")
    : current.status;

  const startCheckout = async (planId: string) => {
    setBusy(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, locale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "checkout_failed");
        return;
      }
      const data = (await res.json()) as { url: string };
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("__portal__");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "portal_failed");
        return;
      }
      const data = (await res.json()) as { url: string };
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const currentPlan = plans.find((p) => p.id === current.planId);
  const renewISO = current.currentPeriodEnd;
  const renewDate =
    renewISO !== null && renewISO !== ""
      ? new Date(renewISO).toLocaleDateString(locale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-slate-400">{t("subtitle")}</p>
      </header>

      <section className="glass-strong flex flex-col gap-4 rounded-2xl border border-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CreditCard className="size-5 text-emerald-300" />
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">
                {t("current.label")}
              </p>
              <p className="text-lg font-medium text-slate-100">
                {currentPlan?.name ?? current.planId}
                <span className="ms-2 text-sm font-normal text-slate-400">
                  · {statusLabel}
                </span>
              </p>
              {renewDate ? (
                <p className="text-xs text-slate-400">
                  {current.cancelAtPeriodEnd
                    ? t("current.endsOn", { date: renewDate })
                    : t("current.renewsOn", { date: renewDate })}
                </p>
              ) : null}
            </div>
          </div>
          {current.provider === "stripe" ? (
            <button
              type="button"
              onClick={openPortal}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
            >
              {busy === "__portal__" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              {t("portal.cta")}
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {t("errors.generic")}: {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans
          .filter((p) => knownPlanIds.includes(p.id))
          .map((p) => {
            const isCurrent = p.id === current.planId;
            const isFree = p.id === "free";
            return (
              <article
                key={p.id}
                className={`flex flex-col gap-3 rounded-2xl border p-5 transition ${
                  isCurrent
                    ? "border-emerald-400/40 bg-emerald-400/5"
                    : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <header className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-medium text-slate-100">
                    {p.name}
                  </h2>
                  {isCurrent ? (
                    <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-xs font-medium text-emerald-200">
                      {t("badge.current")}
                    </span>
                  ) : null}
                </header>
                <p className="text-2xl font-semibold text-slate-100">
                  {formatMinor(p.priceMinor, p.currency)}
                  <span className="text-sm font-normal text-slate-400">
                    {" "}
                    /{" "}
                    {KNOWN_INTERVALS.has(p.billingInterval)
                      ? t(`interval.${p.billingInterval}` as "interval.month")
                      : p.billingInterval}
                  </span>
                </p>
                {!isFree && !isCurrent ? (
                  <button
                    type="button"
                    onClick={() => startCheckout(p.id)}
                    disabled={busy !== null}
                    className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
                  >
                    {busy === p.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {t("plan.upgrade")}
                  </button>
                ) : null}
                {isFree && !isCurrent ? (
                  <p className="mt-auto text-xs text-slate-500">
                    {t("plan.freeContact")}
                  </p>
                ) : null}
              </article>
            );
          })}
      </section>

      <p className="text-xs text-slate-500">{t("vat.note")}</p>
    </div>
  );
}
