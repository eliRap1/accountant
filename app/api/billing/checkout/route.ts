// POST /api/billing/checkout
//
// Body: { planId: "solo" | "plus" | "business" | "accountant", locale?: string }
// Response: { url: string }   — redirect target for Stripe-hosted Checkout
//
// Flow:
//   1. requireCurrentUser() — must be signed in
//   2. Validate planId (must be one of our paid tiers)
//   3. Resolve (or create) a Stripe customer for this app user
//   4. Create a subscription-mode Checkout Session for the matching price
//   5. Return { url } so the client redirects
//
// Verified 2026-05-16 via WebFetch:
//   * stripe.checkout.sessions.create — current Node SDK call shape
//     (source: https://docs.stripe.com/api/checkout/sessions/create)
//   * mode='subscription' with line_items[].price + line_items[].quantity
//     is the documented subscription pattern
//     (source: https://docs.stripe.com/billing/subscriptions/build-subscriptions)
//
// VAT / Israeli tax handling: Stripe Tax does NOT support Israel as of
// 2026-05-16 (https://docs.stripe.com/tax/supported-countries — Israel
// not in the supported list). Consequently we do NOT enable
// automatic_tax: { enabled: true }. Israeli VAT (18% as of 2026, per
// rules-2026) will be applied via Stripe tax_rates objects in a follow-up
// pass, or via our own קבלה generation post-charge (Plan v4 Phase C).
// The plan prices in DB (Solo ₪49 / Plus ₪99 / Business ₪199 / Accountant
// ₪399) are stored VAT-INCLUSIVE for the B2C IL market per AGENTS.md.

import type Stripe from "stripe";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { resolveStripeCustomer } from "@/lib/billing/customer";
import {
  getStripePriceId,
  isPaidPlan,
  isPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import { getStripe, StripeNotConfiguredError } from "@/lib/billing/stripe";
import { routing } from "@/i18n/routing";

// Stripe Checkout's `locale` param does not include "he" (Hebrew) as of
// the dahlia API version — verified 2026-05-16 against the type union in
// node_modules/stripe/esm/resources/Checkout/Sessions.d.ts line 2511.
// For Hebrew users we pass "auto" so Stripe detects from the browser;
// for Russian we pass "ru"; otherwise "en". This keeps the Checkout
// chrome aligned with the user's app locale without crashing on
// unsupported values.
function stripeCheckoutLocale(
  locale: string | undefined,
): "auto" | "en" | "ru" {
  const lang = (locale ?? routing.defaultLocale).split("-")[0];
  if (lang === "ru") return "ru";
  if (lang === "en") return "en";
  return "auto";
}

// Locale-aware success/cancel URL builder. Falls back to defaultLocale
// when the client passes a value the proxy wouldn't accept.
function buildReturnUrl(
  base: string,
  locale: string | undefined,
  path: "success" | "cancel",
): string {
  const safe = (
    routing.locales as readonly string[]
  ).includes(locale ?? "")
    ? (locale as string)
    : routing.defaultLocale;
  // Append a session_id placeholder so the success page can poll
  // /api/billing/status with the right context once the webhook lands.
  const suffix =
    path === "success"
      ? "?session_id={CHECKOUT_SESSION_ID}"
      : "";
  return `${base}/${safe}/billing/${path}${suffix}`;
}

type CheckoutBody = {
  planId?: unknown;
  locale?: unknown;
};

// Route handler runs in Node (Stripe SDK uses Node crypto). Force
// dynamic so the cookie-based session lookup is never elided.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isPlanId(body.planId)) {
    return Response.json({ error: "invalid_plan" }, { status: 400 });
  }
  const planId: PlanId = body.planId;
  if (!isPaidPlan(planId)) {
    return Response.json({ error: "free_plan_not_payable" }, { status: 400 });
  }

  const locale = typeof body.locale === "string" ? body.locale : undefined;

  // Stripe SDK + price-ID guards. Both throw clearly-named errors so the
  // 500 response includes a actionable message in dev.
  let stripe: Stripe;
  let priceId: string;
  try {
    stripe = getStripe();
    const resolved = getStripePriceId(planId);
    if (!resolved) {
      return Response.json({ error: "free_plan_not_payable" }, { status: 400 });
    }
    priceId = resolved;
  } catch (e) {
    if (e instanceof StripeNotConfiguredError) {
      return Response.json(
        { error: "stripe_not_configured" },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "stripe_config_error", message: (e as Error).message },
      { status: 500 },
    );
  }

  // Resolve customer
  const customer = await resolveStripeCustomer(
    locale === undefined
      ? { appUserId: user.appUserId }
      : { appUserId: user.appUserId, locale },
  );

  // Build absolute return URLs from request origin (works in preview +
  // prod without a baked-in NEXT_PUBLIC_APP_URL).
  const origin = new URL(request.url).origin;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customer.customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // IMPORTANT: Stripe Tax does NOT support Israel — do not enable
        // automatic_tax here. See the file header for the verification.
        success_url: buildReturnUrl(origin, locale, "success"),
        cancel_url: buildReturnUrl(origin, locale, "cancel"),
        client_reference_id: user.appUserId,
        // Metadata is mirrored onto the resulting Subscription via
        // subscription_data.metadata so customer.subscription.*
        // webhooks can resolve back to our app user without an extra
        // Stripe call.
        metadata: {
          app_user_id: user.appUserId,
          plan_id: planId,
        },
        subscription_data: {
          metadata: {
            app_user_id: user.appUserId,
            plan_id: planId,
          },
        },
        locale: stripeCheckoutLocale(locale),
      },
      {
        // Idempotency key prevents the user double-clicking from
        // creating two Sessions. Scoped to (user, plan, minute) so
        // retries from a stalled UI still de-dupe.
        idempotencyKey: `checkout-${user.appUserId}-${planId}-${Math.floor(Date.now() / 60000)}`,
      },
    );
  } catch (e) {
    return Response.json(
      { error: "stripe_create_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  if (!session.url) {
    return Response.json({ error: "stripe_no_url" }, { status: 502 });
  }

  return Response.json({ url: session.url });
}
