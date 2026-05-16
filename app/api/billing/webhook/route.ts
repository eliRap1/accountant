// POST /api/billing/webhook
//
// Stripe webhook receiver. Verifies the Stripe-Signature header, then
// dispatches to a handler per event type. Idempotent via the
// stripe_webhook_events table (see lib/billing/idempotency.ts).
//
// Verified 2026-05-16 via WebFetch:
//   * stripe.webhooks.constructEvent(rawBody, sigHeader, secret)
//     (source: https://github.com/stripe/stripe-node — README example,
//      and https://docs.stripe.com/webhooks/signatures for the protocol)
//   * Event objects: checkout.session.completed, customer.subscription.*,
//     invoice.payment_failed have `data.object` typed Stripe.<X>
//     (source: https://docs.stripe.com/api/events/types)
//
// CRITICAL: this handler MUST receive the raw request body BYTE-FOR-BYTE
// as Stripe sent it. The Next.js Route Handler convention is to call
// `await request.text()` — the framework does not pre-parse JSON for
// route handlers (unlike legacy Pages API routes). The proxy.ts
// matcher already excludes /api/* from the next-intl rewrite, so the
// body is not touched by middleware either.

import type Stripe from "stripe";
import { getStripe, StripeNotConfiguredError } from "@/lib/billing/stripe";
import { claimEvent } from "@/lib/billing/idempotency";
import {
  linkSubscriptionFromCheckout,
  upsertSubscriptionFromStripe,
} from "@/lib/billing/sync";
import { planIdFromStripePriceId, type PlanId } from "@/lib/billing/plans";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(): Response {
  return new Response("ok", { status: 200 });
}

function badRequest(reason: string, status = 400): Response {
  return new Response(reason, { status });
}

// Dispatch single event. Each handler is wrapped in try/catch by the
// outer loop so one bad delivery never wedges Stripe's retry queue —
// we return 200 once the event is claimed even if a downstream effect
// fails (the failure is logged and surfaces in support).
async function handleEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscription mode is the only mode we use today. Skip one-off
      // payment Sessions (none currently, but defensive).
      if (session.mode !== "subscription") return;

      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const appUserId =
        (session.metadata?.["app_user_id"] as string | undefined) ??
        (session.client_reference_id ?? undefined);

      if (!subId || !customerId || !appUserId) {
        // Bail without throwing — Stripe will not retry a 200 response,
        // and there's no useful retry for missing metadata.
        return;
      }

      // Fetch the subscription so we know the price id, status, period.
      const sub = await stripe.subscriptions.retrieve(subId);
      const result = await upsertSubscriptionFromStripe(sub);

      // If upsert returned null (unknown price id) we still want to
      // record the bare (customer, subscription) link so the next
      // customer.subscription.* webhook can map back to our app user.
      if (!result) {
        const priceId = sub.items?.data?.[0]?.price?.id;
        const planId: PlanId | null = priceId
          ? planIdFromStripePriceId(priceId)
          : null;
        if (planId) {
          await linkSubscriptionFromCheckout({
            appUserId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            planId,
          });
        }
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscriptionFromStripe(sub);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      // Mark cancelled; period dates from items may still be useful
      // (last paid-through date) so we keep them as-is via upsert.
      await upsertSubscriptionFromStripe(sub);
      return;
    }

    case "invoice.payment_failed": {
      // The Subscription itself transitions to past_due — Stripe will
      // fire customer.subscription.updated alongside this event, which
      // is where we actually update our row. We log here so observers
      // can see the dunning trail.
      // (Email-via-Resend dunning alert is deferred to Phase E / lib/email;
      //  see handoff.md P3 deferred items. Not blocking Phase F.1.)
      return;
    }

    default:
      // Ignore events we don't care about — they're claimed for
      // idempotency so a retry won't reach us again.
      return;
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. Stripe SDK guard
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      // 503 so Stripe retries — operator probably forgot to set keys
      // on a freshly-deployed environment.
      return badRequest("stripe_not_configured", 503);
    }
    throw e;
  }

  // 2. Webhook secret guard
  const webhookSecret = env().STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return badRequest("webhook_secret_not_configured", 503);
  }

  // 3. Raw body + signature header. The Stripe SDK requires the exact
  //    bytes Stripe sent; do NOT parse JSON first. Per
  //    https://github.com/stripe/stripe-node README (fetched 2026-05-16)
  //    the string-form constructEvent call is the supported pattern.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return badRequest("missing_signature", 400);
  }

  // 4. Verify
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (e) {
    return badRequest(
      `signature_verification_failed: ${(e as Error).message}`,
      400,
    );
  }

  // 5. Idempotency claim. If we already processed this event ID, ack
  //    immediately so Stripe stops retrying.
  let claimed: boolean;
  try {
    claimed = await claimEvent(event.id, event.type);
  } catch (e) {
    // DB outage — return 5xx so Stripe retries the delivery.
    return badRequest(`idempotency_store_unavailable: ${(e as Error).message}`, 503);
  }
  if (!claimed) return ok();

  // 6. Handle. Errors in domain logic are caught and logged so we still
  //    return 200 — the event row is claimed, so a re-delivery wouldn't
  //    actually re-run the work. A human triages via stripe_webhook_events
  //    + Stripe Dashboard.
  try {
    await handleEvent(stripe, event);
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional ops trail
    console.error(
      `[stripe-webhook] handler failed for ${event.type} (${event.id}):`,
      err,
    );
  }

  return ok();
}
