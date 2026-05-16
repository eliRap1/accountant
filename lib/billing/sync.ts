// Sync a Stripe Subscription object into our `subscriptions` table.
//
// The webhook handler calls this on:
//   * checkout.session.completed     (initial activation, after fetching
//                                      the subscription via stripe.subscriptions.retrieve)
//   * customer.subscription.updated  (status / period date changes)
//   * customer.subscription.deleted  (final cancellation)
//
// Stripe-API-shape note (verified 2026-05-16 via WebFetch against
// https://docs.stripe.com/api/subscriptions/object): in the current API
// (2026-04-22.dahlia) `current_period_start` and `current_period_end`
// live on each subscription ITEM (items.data[i].current_period_*),
// NOT on the top-level subscription. For a single-item subscription
// (which is what our 5-tier plans use) we take the first item's window.
//
// Status mapping (Stripe -> ours):
//   trialing            -> trialing
//   active              -> active
//   past_due | unpaid   -> past_due
//   canceled            -> cancelled  (our enum spells it British-style)
//   incomplete          -> trialing   (treat unfinished SCA as a pre-active state)
//   incomplete_expired  -> expired
//   paused              -> past_due
//
// Why no `for update` lock: the subscriptions row is upserted by
// (provider_subscription_id) via the partial unique index from
// db/schema/billing.ts, and the row write is a single SQL statement.
// Multiple concurrent webhooks for the same subscription will land on
// the same row and the later one will win on updated_at.

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { planIdFromStripePriceId, type PlanId } from "@/lib/billing/plans";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired";

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case "trialing":
    case "incomplete":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "incomplete_expired":
      return "expired";
    default:
      // Defensive: a future Stripe status string we haven't mapped yet
      // should never silently become "active". Treat as past_due so a
      // human notices in support.
      return "past_due";
  }
}

function unixToDate(value: number | null | undefined): Date | null {
  if (value == null) return null;
  return new Date(value * 1000);
}

/**
 * Pick the (single) Price ID off a Stripe subscription. Returns null if
 * the subscription has zero items (shouldn't happen with our plans).
 */
function firstPriceId(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  return item?.price?.id ?? null;
}

/**
 * Pick the (single) item's current billing period. In the dahlia API
 * version this is on items, not on the subscription root.
 */
function periodFromItems(sub: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number | null;
        current_period_end?: number | null;
      })
    | undefined;
  return {
    start: unixToDate(item?.current_period_start),
    end: unixToDate(item?.current_period_end),
  };
}

export type UpsertResult = {
  /** Our app user this subscription belongs to, resolved via metadata.app_user_id. */
  appUserId: string;
  planId: PlanId;
  status: SubscriptionStatus;
};

/**
 * Upsert a `subscriptions` row from a fresh Stripe Subscription object.
 *
 * The app user is resolved via Stripe metadata `app_user_id` (which we
 * set when creating the Checkout Session). If metadata is missing we
 * fall back to looking up the most recent subscription row by Stripe
 * customer ID — covers an edge case where a customer was created via
 * the Stripe Dashboard.
 */
export async function upsertSubscriptionFromStripe(
  sub: Stripe.Subscription,
): Promise<UpsertResult | null> {
  const stripeCustomerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!stripeCustomerId) {
    throw new Error("upsertSubscriptionFromStripe: missing customer id");
  }

  const priceId = firstPriceId(sub);
  const planId = priceId ? planIdFromStripePriceId(priceId) : null;
  if (!planId) {
    // Could be a manual price (e.g. a custom-enterprise deal) we don't
    // know about — log and skip rather than crash.
    return null;
  }

  const status = mapStatus(sub.status);
  const { start, end } = periodFromItems(sub);
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const cancelledAt = unixToDate(sub.canceled_at);

  // Resolve the app user. metadata.app_user_id is the canonical key.
  const appUserId =
    (sub.metadata?.["app_user_id"] as string | undefined) ?? null;

  const resolved = await withServiceRole(async (tx) => {
    let userId = appUserId;
    if (!userId) {
      const fallback = (await tx.execute(
        sql`SELECT user_id
              FROM subscriptions
             WHERE provider = 'stripe'
               AND provider_customer_id = ${stripeCustomerId}
             ORDER BY created_at DESC
             LIMIT 1`,
      )) as unknown as Array<{ user_id: string }>;
      userId = fallback[0]?.user_id ?? null;
    }
    if (!userId) return null;

    // UPSERT by provider_subscription_id. The partial unique index
    // (subscriptions_provider_sub_idx) makes this safe under concurrent
    // webhook deliveries — Postgres serialises on the index entry.
    await tx.execute(
      sql`INSERT INTO subscriptions (
              user_id, plan_id, provider, provider_customer_id,
              provider_subscription_id, current_period_start,
              current_period_end, status, cancel_at_period_end,
              cancelled_at
            )
          VALUES (
              ${userId}::uuid, ${planId}, 'stripe', ${stripeCustomerId},
              ${sub.id}, ${start}, ${end}, ${status}::subscription_status,
              ${cancelAtPeriodEnd}, ${cancelledAt}
            )
          ON CONFLICT (provider_subscription_id)
          WHERE provider_subscription_id IS NOT NULL
          DO UPDATE SET
            plan_id              = EXCLUDED.plan_id,
            provider_customer_id = EXCLUDED.provider_customer_id,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end   = EXCLUDED.current_period_end,
            status               = EXCLUDED.status,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end,
            cancelled_at         = EXCLUDED.cancelled_at,
            updated_at           = now()`,
    );
    return userId;
  });

  if (!resolved) return null;
  return { appUserId: resolved, planId, status };
}

/**
 * Lighter-weight upsert used by the checkout.session.completed path —
 * we don't yet have a Subscription object in hand, only the Checkout
 * Session. Records the (customer, subscription) link so subsequent
 * customer.subscription.* webhooks can find the app user even if their
 * metadata is missing.
 */
export async function linkSubscriptionFromCheckout(args: {
  appUserId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: PlanId;
}): Promise<void> {
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`INSERT INTO subscriptions (
              user_id, plan_id, provider, provider_customer_id,
              provider_subscription_id, status
            )
          VALUES (
              ${args.appUserId}::uuid, ${args.planId}, 'stripe',
              ${args.stripeCustomerId}, ${args.stripeSubscriptionId},
              'active'::subscription_status
            )
          ON CONFLICT (provider_subscription_id)
          WHERE provider_subscription_id IS NOT NULL
          DO UPDATE SET
            plan_id              = EXCLUDED.plan_id,
            provider_customer_id = EXCLUDED.provider_customer_id,
            updated_at           = now()`,
    );
  });
}
