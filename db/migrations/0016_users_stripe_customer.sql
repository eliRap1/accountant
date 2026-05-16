-- 0016_users_stripe_customer.sql
--
-- The Stripe customer ID was previously sourced from
-- `subscriptions.provider_customer_id` — but the row only exists AFTER
-- a successful `customer.subscription.*` webhook. If the webhook
-- never lands (bug, network, deploy outage), the next checkout call
-- finds no cached customer ID and creates ANOTHER Stripe customer
-- for the same user — duplicating billing history.
--
-- Add a dedicated cache column on `users` that is written immediately
-- after `stripe.customers.create` returns, so re-checkout converges
-- on the same Stripe customer regardless of webhook state.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Soft uniqueness — one Stripe customer per app user. Partial so
-- pre-billing users (the majority) don't fight a NULL-unique.
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
