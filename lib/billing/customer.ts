// Resolve (or create) the Stripe Customer object for one of our users.
//
// Storage: subscriptions.provider_customer_id holds the stripe customer
// ID (cus_xxx). The row is upserted lazily — most users never check out,
// so we don't pre-create customers in Stripe.
//
// On checkout-session creation we always look up the existing customer
// first (via the most recent subscription row for the user); only if
// none is found do we call stripe.customers.create.
//
// Verified 2026-05-16 against:
//   https://docs.stripe.com/api/customers/create
//   — `stripe.customers.create({ email, name, metadata, address })`
//   — returns Customer with `id` (cus_xxx).
//
// Note: per Stripe docs as of 2026-04-22 the Accounts v2 API is
// preferred over Customers v1 for new integrations, but the entire
// Checkout + Billing Portal surface still accepts `customer` (v1) as a
// first-class parameter and the Customer object is the recommended path
// for self-serve SaaS subscriptions today. We stay on Customers v1 to
// minimise API-surface churn; if Stripe deprecates the legacy API the
// migration is a single field rename on the Checkout call (customer ->
// customer_account).

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { withServiceRole } from "@/lib/db/withServiceRole";

export type ResolvedCustomer = {
  customerId: string;
  /** true when this call created the Stripe customer; useful for logging. */
  created: boolean;
};

type UserRow = { email: string; name: string | null };

/**
 * Find any existing Stripe customer ID we have on record for this user.
 * Returns null if no subscription row references a Stripe customer yet.
 */
async function findExistingCustomerId(
  appUserId: string,
): Promise<string | null> {
  return withServiceRole(async (tx) => {
    // Primary: `users.stripe_customer_id` — written immediately after
    // every successful `stripe.customers.create` so a missed webhook
    // never causes a duplicate customer.
    const userRows = (await tx.execute(
      sql`SELECT stripe_customer_id
            FROM users
           WHERE id = ${appUserId}::uuid
           LIMIT 1`,
    )) as unknown as Array<{ stripe_customer_id: string | null }>;
    const fromUser = userRows[0]?.stripe_customer_id ?? null;
    if (fromUser) return fromUser;

    // Legacy fallback: rows created before migration 0016 only
    // recorded the customer id on the subscriptions table.
    const subRows = (await tx.execute(
      sql`SELECT provider_customer_id
            FROM subscriptions
           WHERE user_id = ${appUserId}::uuid
             AND provider = 'stripe'
             AND provider_customer_id IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 1`,
    )) as unknown as Array<{ provider_customer_id: string | null }>;
    return subRows[0]?.provider_customer_id ?? null;
  });
}

/** Cache the customer_id on `users.stripe_customer_id` so the next
 *  resolve call returns it without touching Stripe. Idempotent. */
async function cacheCustomerId(
  appUserId: string,
  customerId: string,
): Promise<void> {
  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`UPDATE users
            SET stripe_customer_id = ${customerId}
          WHERE id = ${appUserId}::uuid
            AND stripe_customer_id IS NULL`,
    );
  });
}

/**
 * Get the app user's email + display name for the Stripe customer record.
 * Reads `users.email` (FK to Better Auth user table via auth_user_id)
 * lazily through the auth user table — that's where the verified email
 * lives. We use service role because the auth `"user"` table is not
 * routed through RLS.
 */
async function loadUserContact(appUserId: string): Promise<UserRow | null> {
  return withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT au.email, au.name
            FROM users u
            JOIN "user" au ON au.id = u.auth_user_id
           WHERE u.id = ${appUserId}::uuid
           LIMIT 1`,
    )) as unknown as Array<UserRow>;
    return rows[0] ?? null;
  });
}

type ResolveStripeCustomerArgs =
  | { appUserId: string; locale: string }
  | { appUserId: string };

/**
 * Resolve (find-or-create) the Stripe customer for an app user. Safe to
 * call multiple times; subsequent calls return the cached ID without
 * touching Stripe. We do NOT persist a "customers" row in our DB — the
 * Stripe customer ID lives on the subscription row that the caller
 * upserts after this returns.
 *
 * `locale` is optional but with exactOptionalPropertyTypes we must use
 * a union type rather than `locale?: string` to allow callers to omit
 * the property entirely.
 */
export async function resolveStripeCustomer(
  args: ResolveStripeCustomerArgs,
): Promise<ResolvedCustomer> {
  const localeOrFallback = "locale" in args ? args.locale : undefined;
  const existing = await findExistingCustomerId(args.appUserId);
  if (existing) return { customerId: existing, created: false };

  const contact = await loadUserContact(args.appUserId);
  if (!contact) {
    throw new Error(
      `resolveStripeCustomer: app user ${args.appUserId} has no auth contact row`,
    );
  }

  const stripe = getStripe();
  // Stripe Tax does NOT support Israel as of 2026-05-16
  // (https://docs.stripe.com/tax/supported-countries — Israel not
  // listed). We still set address.country indirectly via metadata so
  // Radar can risk-score and the customer record stays clean; tax
  // calculation itself is handled outside Stripe.
  //
  // exactOptionalPropertyTypes: true means we can't pass `name:
  // undefined` — only conditionally include the property at all.
  const params: Stripe.CustomerCreateParams = {
    email: contact.email,
    metadata: {
      app_user_id: args.appUserId,
      locale: localeOrFallback ?? "he-IL",
    },
  };
  if (contact.name) params.name = contact.name;
  const customer = await stripe.customers.create(params);
  // Persist immediately so a webhook race or outright failure
  // doesn't cause the next checkout to fork a new customer for the
  // same user. Idempotent — partial-unique index protects against
  // concurrent inserts.
  await cacheCustomerId(args.appUserId, customer.id);
  return { customerId: customer.id, created: true };
}
