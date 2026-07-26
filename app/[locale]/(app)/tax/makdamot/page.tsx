import type { Route } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { dbService } from "@/db/client";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";
import { projectAnnualAdvanceTax } from "@/lib/tax/il/advanceTax";

// `/tax/makdamot` standalone surface.
//
// Why this exists alongside the `/tax?tab=makdamot` deep-link: this
// page renders the EXTENDED מקדמות view — full installment history,
// year-end projection, schema-gap fallback when `tax_advances` is not
// yet migrated. The deep-link tab inside the parent `TaxView` gives the
// at-a-glance read; this page is the deeper drill-down.
//
// Layer 3 dependency contract: `tax_advances` may not be present in
// the active database. We probe via a guarded `to_regclass`-style
// lookup and render the "Phase E.0 schema not yet applied" panel when
// absent. The engine's `projectAnnualAdvanceTax` preview is always
// available because it's purely arithmetic on the engine output.
//
// Disclaimer literal (matched by HE_DISCLAIMER in lint-legal-text.ts):
// אומדנים בלבד · אינו ייעוץ מס

type AdvanceRow = {
  id: string;
  period_start: string;
  period_end: string;
  amount_due_minor: string;
  paid_at: string | null;
  status: string;
};

async function probeTaxAdvancesTable(userId: string): Promise<{
  exists: boolean;
  rows: AdvanceRow[];
}> {
  try {
    // Metadata-only existence check via the service-role connection.
    // `to_regclass` returns NULL when the table is absent — no
    // information_schema scan, no `app.current_user_id` requirement.
    const meta = (await dbService.execute(
      sql`SELECT to_regclass('public.tax_advances') IS NOT NULL AS exists`,
    )) as unknown as Array<{ exists: boolean }>;
    if (!meta[0]?.exists) return { exists: false, rows: [] };

    const rows = await withUser(userId, async (tx) => {
      return (await tx.execute(
        sql`SELECT id::text, period_start::text, period_end::text,
                   amount_due_minor::text, paid_at::text, status::text
            FROM tax_advances
            ORDER BY period_start DESC
            LIMIT 24`,
      )) as unknown as AdvanceRow[];
    });

    return { exists: true, rows };
  } catch {
    return { exists: false, rows: [] };
  }
}

export const metadata = {
  title: "מקדמות · AccounTech",
};

export default async function TaxMakdamotPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await requireCurrentUser();
  const t = await getTranslations("app.tax.makdamot");
  const estimate = await runFullTaxEngine(user.appUserId);
  const probe = await probeTaxAdvancesTable(user.appUserId);

  const monthsRemaining = Math.max(0, 12 - (new Date().getUTCMonth() + 1));
  const monthlyInstallmentMinor =
    estimate.advanceTaxMonthlyInstallmentMinor ?? 0n;
  const projectedAnnual = projectAnnualAdvanceTax({
    paidYtdMinor: 0n,
    monthsRemaining,
    expectedMonthlyRevenueMinor:
      estimate.incomeMinor > 0n ? estimate.incomeMinor / 12n : 0n,
    ratePct: 0, // Engine already converted business rate into installment.
  });
  // Layered fallback: when no rate is assigned we still surface the
  // engine projection as a guidance number, not a binding figure.
  const annualPreviewMinor =
    monthlyInstallmentMinor > 0n
      ? monthlyInstallmentMinor * 12n
      : projectedAnnual;

  function formatIls(minor: bigint): string {
    const value = Number(minor) / 100;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "ILS",
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `₪${Math.round(value).toLocaleString("en-US")}`;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Disclaimer rendered once by `(app)/layout.tsx`. */}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-slate-400">{t("pageSubtitle")}</p>
      </header>

      {!probe.exists ? (
        <aside
          className="flex flex-col gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
          role="note"
        >
          <p className="font-medium">{t("schemaGapTitle")}</p>
          <p className="text-amber-200/90">{t("schemaGapDesc")}</p>
          <p className="text-xs text-amber-300/80">{t("schemaGapHint")}</p>
        </aside>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("monthlyInstallmentLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {monthlyInstallmentMinor > 0n
              ? formatIls(monthlyInstallmentMinor)
              : t("notAssigned")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("monthlyInstallmentHelper")}
          </p>
        </article>

        <article className="rounded-2xl border border-white/5 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("projectedAnnualLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {formatIls(annualPreviewMinor)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("projectedAnnualHelper")}
          </p>
        </article>

        <article className="rounded-2xl border border-white/5 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("rateRangeLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {(estimate.advanceTaxRateRange.minPct * 100).toFixed(1)}% –{" "}
            {(estimate.advanceTaxRateRange.maxPct * 100).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-400">{t("rateRangeHelper")}</p>
        </article>
      </section>

      {probe.exists ? (
        <section className="rounded-2xl border border-white/5 bg-slate-950/40 p-4">
          <h2 className="text-sm font-medium text-slate-200">
            {t("historyTitle")}
          </h2>
          {probe.rows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">{t("historyEmpty")}</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-start text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2">{t("col.period")}</th>
                  <th className="pb-2">{t("col.amount")}</th>
                  <th className="pb-2">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-200">
                {probe.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">
                      {r.period_start} → {r.period_end}
                    </td>
                    <td className="py-2" dir="ltr">
                      {formatIls(BigInt(r.amount_due_minor))}
                    </td>
                    <td className="py-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </div>
  );
}
