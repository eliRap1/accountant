"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Business = { id: string; legalName: string };
type Props = { businesses: Business[] };

// Period-picker + submit. POSTs /api/audit/build, polls until the
// response settles (one request — no separate /status endpoint), and
// either redirects to the detail page or surfaces a localized error.
//
// 401 step_up_required cases are surfaced as a directive (the user
// needs to step-up; in a fuller implementation we'd open the
// /api/auth/step-up modal here).
export default function NewAuditPackageForm({ businesses }: Props) {
  const t = useTranslations("app.audit");
  const router = useRouter();

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const [businessId, setBusinessId] = useState<string>(
    businesses[0]?.id ?? "",
  );
  const [periodStart, setPeriodStart] = useState<string>(monthStart);
  const [periodEnd, setPeriodEnd] = useState<string>(monthEnd);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, periodStart, periodEnd }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (res.status === 401 && body.error === "step_up_required") {
          setError(t("errors.stepUpRequired"));
        } else if (res.status === 403) {
          setError(t("errors.forbidden"));
        } else {
          setError(t("errors.generic"));
        }
        return;
      }
      const body = (await res.json()) as { packageId: string };
      router.push(`/audit/${body.packageId}` as `/${string}`);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass-strong space-y-5 rounded-2xl p-6">
      <div>
        <label
          htmlFor="audit-business"
          className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-400"
        >
          {t("business")}
        </label>
        <select
          id="audit-business"
          name="businessId"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          required
          className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.legalName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="audit-period-start"
            className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-400"
          >
            {t("periodStart")}
          </label>
          <input
            type="date"
            id="audit-period-start"
            name="periodStart"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
            className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <div>
          <label
            htmlFor="audit-period-end"
            className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-slate-400"
          >
            {t("periodEnd")}
          </label>
          <input
            type="date"
            id="audit-period-end"
            name="periodEnd"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
            className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !businessId}
        className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {submitting ? t("buildSubmitting") : t("buildSubmit")}
      </button>
    </form>
  );
}
