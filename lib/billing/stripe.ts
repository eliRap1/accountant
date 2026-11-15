// Server-side Stripe SDK singleton.
//
// Lazy-initialised so importing this module from an Edge / Static context
// does not crash the build when STRIPE_SECRET_KEY is unset (e.g. a fresh
// preview deploy that does not yet have billing secrets). Every caller
// MUST go through getStripe() — direct `new Stripe(...)` is forbidden
// because it would bypass the env-presence check below.
//
// Versions verified 2026-05-16 via WebFetch:
//   * Stripe Node SDK    — stripe@22.1.1 (released 2026-05-06, source:
//     https://github.com/stripe/stripe-node)
//   * Stripe API version — 2026-04-22.dahlia
//     (source: https://docs.stripe.com/api/versioning fetched 2026-05-16)
//
// We pin the apiVersion explicitly because stripe-node v12+ otherwise
// defaults to whatever was current at SDK release time — pinning ensures
// webhook payload shapes (notably items.data[].current_period_* on the
// Subscription object) stay stable when bumping the SDK.

import Stripe from "stripe";
import { env } from "@/lib/env";

// The exact API-version literal the SDK was built against (stripe@22.1.1
// → "2026-04-22.dahlia"). We pass this through `as never` so TS accepts
// our pinned string even when the SDK's internal LatestApiVersion type
// drifts ahead of the docs — verified 2026-05-16 against
// https://docs.stripe.com/api/versioning.
const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

let cached: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      "Stripe is not configured: set STRIPE_SECRET_KEY in the environment.",
    );
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();

  // The SDK pins apiVersion to a single literal (LatestApiVersion =
  // typeof ApiVersion); a plain string assignment fails the literal
  // narrowing under strict mode. Cast through `unknown` to the
  // constructor's parameter type. The runtime value is what the docs
  // document; the type assertion is only a hint.
  type StripeOpts = NonNullable<ConstructorParameters<typeof Stripe>[1]>;
  type ApiVer = StripeOpts extends { apiVersion?: infer A } ? A : string;
  const apiVersion = STRIPE_API_VERSION as unknown as ApiVer;

  cached = new Stripe(key, {
    apiVersion,
    typescript: true,
    appInfo: {
      name: "AccounTech",
      version: "0.1.0",
    },
  });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(env().STRIPE_SECRET_KEY);
}

export { STRIPE_API_VERSION };
