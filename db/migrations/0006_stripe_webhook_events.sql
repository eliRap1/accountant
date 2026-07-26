-- Phase F.1 — Stripe webhook event idempotency.
--
-- Stripe retries webhook deliveries on non-2xx (and occasionally even
-- on 2xx — at-least-once semantics, NOT exactly-once). Without an
-- idempotency table the webhook handler would double-activate
-- subscriptions, double-bill, or send a duplicate dunning email.
--
-- The table is intentionally minimal:
--   * `id` is the Stripe event.id (text PK).
--   * `processed_at` records the first time we successfully handled it.
--   * `event_type` is stored for ops triage (no functional dependence).
--
-- RLS: deliberately NOT enabled — only the service role can read/write
-- this table, and the default GRANTs from migration 0001 already
-- restrict app_user to USAGE on the public schema (no table privileges
-- unless explicitly granted). app_service has full access via its
-- ALL TABLES default privilege grant.
--
-- This table is ALSO useful for ad-hoc replays: if a downstream effect
-- (DB write, email send) fails after the row was inserted, an operator
-- can `DELETE FROM stripe_webhook_events WHERE id = ?` and trigger a
-- replay from the Stripe Dashboard.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id           text PRIMARY KEY,
  event_type   text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

REVOKE ALL ON TABLE stripe_webhook_events FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE stripe_webhook_events TO app_service;--> statement-breakpoint
