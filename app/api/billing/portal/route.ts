// POST /api/billing/portal
//
// Body: { locale?: string }
// Response: { url: string }   — redirect target for the Billing Portal
//
// Verified 2026-05-16 via WebFetch:
//   * stripe.billingPortal.sessions.create(...) — current Node SDK call
//     (source: https://docs.stripe.com/billing/subscriptions/build-subscriptions)
//
// The portal handles: payment method updates, cancellation, plan change
// (when enabled in the Stripe Dashboard portal config), and invoice
// history. We never write to the DB from this route — the portal's
// changes flow back via customer.subscription.updated webhooks.

import type Stripe from "stripe";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { resolveStripeCustomer } from "@/lib/billing/customer";
import { getStripe, StripeNotConfiguredError } from "@/lib/billing/stripe";
import { routing } from "@/i18n/routing";

type PortalBody = { locale?: unknown };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PortalBody = {};
  try {
    // Body is optional — empty body POST is fine.
    const text = await request.text();
    if (text.length > 0) body = JSON.parse(text) as PortalBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const locale = typeof body.locale === "string" ? body.locale : undefined;
  const safeLocale = (
    routing.locales as readonly string[]
  ).includes(locale ?? "")
    ? (locale as string)
    : routing.defaultLocale;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      return Response.json(
        { error: "stripe_not_configured" },
        { status: 503 },
      );
    }
    throw e;
  }

  const customer = await resolveStripeCustomer(
    locale === undefined
      ? { appUserId: user.appUserId }
      : { appUserId: user.appUserId, locale },
  );

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/${safeLocale}/billing`;

  let session: Stripe.BillingPortal.Session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: customer.customerId,
      return_url: returnUrl,
      // No `locale` param on portal sessions — the customer's preferred
      // language stored on the Stripe Customer drives it. We could push
      // it via customers.update if we want strict alignment; deferred.
    });
  } catch (e) {
    return Response.json(
      { error: "stripe_portal_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  return Response.json({ url: session.url });
}
