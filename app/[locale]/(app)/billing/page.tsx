import type { Route } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { sql } from "drizzle-orm";
import BillingView from "./BillingView";
import { routing } from "@/i18n/routing";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";

export const metadata = {
  title: "Billing · AccounTech",
};

type PlanRow = {
  id: string;
  name: string;
  price_minor: string | number | bigint;
  currency: string;
  billing_interval: string;
  sort: number;
};

type SubRow = {
  plan_id: string;
  status: string;
  provider: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};

export default async function BillingPage({
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

  // Load the 5 plans + the user's current subscription (if any) in one
  // service-role round-trip. We don't go through withUser because plans
  // are public-read (no RLS) and subscriptions doesn't have an RLS
  // policy for self-read yet — service role is the safest path.
  const { plans, current } = await withServiceRole(async (tx) => {
    const planRows = (await tx.execute(
      sql`SELECT id, name, price_minor, currency, billing_interval, sort
            FROM plans
           ORDER BY sort ASC`,
    )) as unknown as PlanRow[];

    const subRows = (await tx.execute(
      sql`SELECT plan_id, status, provider, current_period_end, cancel_at_period_end
            FROM subscriptions
           WHERE user_id = ${user.appUserId}::uuid
           ORDER BY created_at DESC
           LIMIT 1`,
    )) as unknown as SubRow[];

    return { plans: planRows, current: subRows[0] ?? null };
  });

  const currentPlanId: PlanId =
    (current?.plan_id as PlanId | undefined) ?? "free";

  const planSummaries = plans.map((p) => ({
    id: p.id,
    name: p.name,
    priceMinor: Number(p.price_minor),
    currency: p.currency,
    billingInterval: p.billing_interval,
  }));

  return (
    <BillingView
      locale={locale}
      plans={planSummaries}
      knownPlanIds={[...PLAN_IDS]}
      current={{
        planId: currentPlanId,
        status: current?.status ?? "none",
        provider: current?.provider ?? "mock",
        currentPeriodEnd:
          current?.current_period_end instanceof Date
            ? current.current_period_end.toISOString()
            : null,
        cancelAtPeriodEnd: Boolean(current?.cancel_at_period_end),
      }}
    />
  );
}
