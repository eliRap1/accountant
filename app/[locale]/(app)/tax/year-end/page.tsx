import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { hasLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import IncomeTaxBracketChart from "@/components/app/tax/IncomeTaxBracketChart";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";

// `/tax/year-end` standalone surface.
//
// Renders the projected annual income tax (post-credit-points + מס יסף
// surtax), Bituach Leumi, and an inline prep-pack CTA. The prep-pack
// downloader is a Phase E filing surface; the CTA links to it
// optimistically (the route may not be implemented yet, in which case
// it 404s — that's intentional UI tension to keep the prep-pack as the
// product's anchor goal).
//
// Disclaimer literal (matched by HE_DISCLAIMER in lint-legal-text.ts):
// אומדנים בלבד · אינו ייעוץ מס

export const metadata = {
  title: "סיום שנה · AccounTech",
};

export default async function TaxYearEndPage({
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
  const t = await getTranslations("app.tax.yearEnd");
  const estimate = await runFullTaxEngine(user.appUserId);

  function formatIls(minor: bigint): string {
    const value = Number(minor) / 100;
    try {
      return new Intl.NumberFormat(locale === "he-IL" ? "he-IL" : "en-IL", {
        style: "currency",
        currency: "ILS",
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `₪${Math.round(value).toLocaleString("en-US")}`;
    }
  }

  const incomeTax = estimate.incomeTax;
  const bituach = estimate.bituachLeumi;

  const serialisedBreakdown =
    incomeTax === null
      ? []
      : incomeTax.breakdown.map((b) => ({
          rangeFromMinor: b.rangeFromMinor.toString(),
          rangeToMinor: b.rangeToMinor === null ? null : b.rangeToMinor.toString(),
          ratePct: b.ratePct,
          slicedIncomeMinor: b.slicedIncomeMinor.toString(),
          taxOnSliceMinor: b.taxOnSliceMinor.toString(),
        }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Disclaimer rendered once by `(app)/layout.tsx`. */}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("pageSubtitle", { year: estimate.year })}
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("netTaxLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {incomeTax !== null ? formatIls(incomeTax.netTaxMinor) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("netTaxHelper", { year: estimate.year })}
          </p>
        </article>

        <article className="rounded-2xl border border-white/5 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("creditValueLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {incomeTax !== null ? formatIls(incomeTax.creditValueMinor) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400">{t("creditValueHelper")}</p>
        </article>

        <article className="rounded-2xl border border-white/5 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t("bituachLabel")}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-50" dir="ltr">
            {bituach !== null ? formatIls(bituach.totalContribMinor) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400">{t("bituachHelper")}</p>
        </article>
      </section>

      {incomeTax !== null ? (
        <IncomeTaxBracketChart
          breakdown={serialisedBreakdown}
          marginalRatePct={incomeTax.marginalRatePct}
          effectiveRatePct={incomeTax.effectiveRatePct}
          surtaxMinor={incomeTax.surtaxMinor.toString()}
          locale={locale}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <p className="flex-1 text-sm text-slate-300">{t("prepPackDesc")}</p>
        <Link
          href={"/filings/form-1301" as Route}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
        >
          {t("prepPackCta")}
        </Link>
      </div>
    </div>
  );
}
