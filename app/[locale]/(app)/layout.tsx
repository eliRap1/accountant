import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { sql } from "drizzle-orm";
import AppShell from "@/components/app/AppShell";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import { routing } from "@/i18n/routing";
import { currentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { getUserBusinesses } from "@/lib/aggregations/userBusinesses";

// Authenticated-only route group. The (auth) tree is reachable
// anonymously; everything under (app) requires a Better Auth session.
// We resolve the session here in the layout so child server components
// can rely on it (and benefit from React `cache()` deduplication).
//
// The estimates-only disclaimer banner is rendered at the top of every
// (app) page — it's regulatory boilerplate (Plan v4 § Locked Decisions:
// "Disclaimer banner on every tax surface"). The wrapper lives in
// chunk C's territory; its server-component wrapper composes cleanly
// from this RSC layout without flipping into a client boundary.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    // The parent [locale]/layout.tsx already 404s on unknown locales,
    // but TypeScript can't tell, so guard again before passing the
    // value to setRequestLocale.
    redirect(`/${routing.defaultLocale}/sign-in` as Route);
  }
  setRequestLocale(locale);

  const user = await currentUser();
  if (!user) {
    redirect(`/${locale}/sign-in` as Route);
  }

  // Q6 (Architecture v5 council answers): when a user has 0 owned AND
  // 0 engaged businesses, redirect at layout level to /onboarding.
  // The only writable state is the onboarding form itself. Allow the
  // onboarding route itself so the user can submit; the dashboard
  // page double-checks via getOnboardingState.
  const ctx = await getUserBusinesses(user.appUserId);
  const hasAnyBusiness = ctx.all.length > 0;

  // CPA-council § 8 "killer feature": show the audit-package sidebar
  // item only to (a) any business owner (so the moment they have
  // bookkeeping data, the export-for-inspector flow is one click
  // away) OR (b) any plan with `audit.package_builder = true` —
  // currently Business and Accountant per scripts/db-seed.ts.
  const auditEnabled = await resolveAuditEnabled(user.appUserId);

  // Product council § 4: "Ledger" sidebar entry only renders when the
  // user has an active business using double-entry bookkeeping. עצמאי
  // single-entry users should never see Ledger.
  const ledgerEnabled = ctx.all.some(
    (b) => b.bookkeepingMethod === "double_entry",
  );

  // Active business: for v1 the first owned (or engaged) one. Multi-
  // business switching arrives once we wire a cookie/session stamp.
  const activeBusinessId = ctx.all[0]?.id ?? null;

  // Pass a serialisable subset to the client switcher. The shell
  // doesn't need bookkeeping_method / vat_status downstream.
  const switcherBusinesses = ctx.all.map((b) => ({
    id: b.id,
    legalName: b.legalName,
    kind: b.kind,
  }));

  return (
    <AppShell
      user={{
        email: user.email,
        name: user.name,
      }}
      auditEnabled={auditEnabled}
      ledgerEnabled={ledgerEnabled}
      businesses={switcherBusinesses}
      activeBusinessId={activeBusinessId}
    >
      {!hasAnyBusiness ? (
        // The /onboarding pages serve their own chrome and don't expect
        // the dashboard disclaimer banner. The (app)/onboarding route
        // tree handles redirect-from-here when needed; we keep the
        // empty container so nested layouts still render.
        <div className="mx-auto mb-4 w-full max-w-7xl" />
      ) : (
        <div className="mx-auto mb-4 w-full max-w-7xl">
          <EstimatesDisclaimerBanner />
        </div>
      )}
      {children}
    </AppShell>
  );
}

async function resolveAuditEnabled(appUserId: string): Promise<boolean> {
  try {
    return await withServiceRole(async (tx) => {
      const ownerRows = (await tx.execute(
        sql`SELECT 1 AS x
              FROM businesses
             WHERE owner_user_id = ${appUserId}::uuid
               AND deleted_at IS NULL
             LIMIT 1`,
      )) as unknown as Array<{ x: number }>;
      if (ownerRows.length > 0) return true;

      // Active subscription on a plan that has audit.package_builder=true.
      const planRows = (await tx.execute(
        sql`SELECT 1 AS x
              FROM subscriptions s
              JOIN plan_entitlements pe ON pe.plan_id = s.plan_id
             WHERE s.user_id = ${appUserId}::uuid
               AND s.status IN ('active', 'trialing')
               AND pe.key = 'audit.package_builder'
               AND pe.value_bool IS TRUE
             LIMIT 1`,
      )) as unknown as Array<{ x: number }>;
      if (planRows.length > 0) return true;

      // Active accountant engagement with filings+ledger scopes — they
      // need the sidebar entry to actually build packages for clients.
      const engRows = (await tx.execute(
        sql`SELECT 1 AS x
              FROM accountant_engagements
             WHERE accountant_user_id = ${appUserId}::uuid
               AND accepted_at IS NOT NULL
               AND revoked_at IS NULL
               AND role = 'accountant'
               AND (scopes_jsonb->>'filings')::boolean IS TRUE
               AND (scopes_jsonb->>'ledger')::boolean IS TRUE
             LIMIT 1`,
      )) as unknown as Array<{ x: number }>;
      return engRows.length > 0;
    });
  } catch {
    return false;
  }
}
