// Plan ID <-> Stripe price ID resolver.
//
// Design choice: price IDs live in env vars, NOT in the DB. Two reasons:
//   1. Avoids a migration to plan_entitlements (the table only has
//      value_int + value_bool today; adding value_text would touch
//      db/schema, which is out of scope for Phase F.1).
//   2. Stripe price IDs are environment-scoped (test vs live), so they
//      naturally belong with the rest of the per-environment secrets.
//
// Operator runbook: after creating products + recurring prices in the
// Stripe Dashboard, copy the `price_xxx` IDs into Vercel env:
//
//   STRIPE_PRICE_SOLO       — Solo ₪49/mo
//   STRIPE_PRICE_PLUS       — Plus ₪99/mo
//   STRIPE_PRICE_BUSINESS   — Business ₪199/mo
//   STRIPE_PRICE_ACCOUNTANT — Accountant ₪399/mo
//
// The "free" plan has no Stripe price (zero-cost / no checkout). Any
// attempt to start a Stripe checkout for the free plan throws.

import { env } from "@/lib/env";

export const PLAN_IDS = [
  "free",
  "solo",
  "plus",
  "business",
  "accountant",
] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

export function isPaidPlan(planId: PlanId): boolean {
  return planId !== "free";
}

export class PlanNotPayableError extends Error {
  constructor(planId: string) {
    super(`Plan "${planId}" has no Stripe price (likely the free tier).`);
    this.name = "PlanNotPayableError";
  }
}

export class StripePriceNotConfiguredError extends Error {
  constructor(planId: string) {
    super(
      `Stripe price ID is not configured for plan "${planId}". ` +
        `Set STRIPE_PRICE_${planId.toUpperCase()} in the environment.`,
    );
    this.name = "StripePriceNotConfiguredError";
  }
}

/**
 * Resolve the Stripe Price ID for a given app plan. Returns `null` for
 * the free tier (which never hits Stripe). Throws for paid tiers whose
 * STRIPE_PRICE_* env var is missing — production must fail loud here.
 */
export function getStripePriceId(planId: PlanId): string | null {
  if (planId === "free") return null;
  const e = env();
  const lookup: Record<Exclude<PlanId, "free">, string | undefined> = {
    solo: e.STRIPE_PRICE_SOLO,
    plus: e.STRIPE_PRICE_PLUS,
    business: e.STRIPE_PRICE_BUSINESS,
    accountant: e.STRIPE_PRICE_ACCOUNTANT,
  };
  const value = lookup[planId];
  if (!value) throw new StripePriceNotConfiguredError(planId);
  return value;
}

/**
 * Reverse map: given a Stripe Price ID (e.g. from a Checkout Session's
 * line_items), return our app plan ID — used by the webhook handler to
 * write subscriptions.plan_id without re-querying Stripe.
 */
export function planIdFromStripePriceId(priceId: string): PlanId | null {
  const e = env();
  if (priceId && priceId === e.STRIPE_PRICE_SOLO) return "solo";
  if (priceId && priceId === e.STRIPE_PRICE_PLUS) return "plus";
  if (priceId && priceId === e.STRIPE_PRICE_BUSINESS) return "business";
  if (priceId && priceId === e.STRIPE_PRICE_ACCOUNTANT) return "accountant";
  return null;
}
