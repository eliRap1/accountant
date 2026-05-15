-- Layer 1 RLS — identity + businesses + billing + ops.
--
-- Pattern:
--   * SECURITY DEFINER helpers stay owned by neondb_owner (the migration
--     connection role) — neondb_owner OWNS the underlying tables and table
--     owners bypass RLS by default in Postgres, so the function body sees
--     unfiltered rows and never re-enters policy evaluation. Mutual
--     recursion between businesses and accountant_engagements policies is
--     thereby broken.
--   * app_current_user_id() is SECURITY INVOKER (no table reads) and reads
--     the GUC populated by lib/db/withUser.ts.
--   * Service-role-only tables (auth_events, rate_limit_buckets,
--     data_encryption_keys) have no policy; the default GRANTs from 0001
--     give app_service access and leave app_user with nothing.

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_current_user_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_user, app_service;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_user_owns_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = b_id
      AND owner_user_id = app_current_user_id()
      AND deleted_at IS NULL
  )
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_user_owns_business(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_owns_business(uuid) TO app_user, app_service;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_user_engages_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM accountant_engagements
    WHERE business_id = b_id
      AND accountant_user_id = app_current_user_id()
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
  )
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_user_engages_business(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_engages_business(uuid) TO app_user, app_service;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_user_can_access_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT app_user_owns_business(b_id) OR app_user_engages_business(b_id)
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_user_can_access_business(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_can_access_business(uuid) TO app_user, app_service;--> statement-breakpoint

-- users: rows are only visible to their owner.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY users_self ON users
  FOR ALL
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user;--> statement-breakpoint

-- businesses: owner can do anything; engaged accountant can SELECT only.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY businesses_select ON businesses
  FOR SELECT
  USING (
    owner_user_id = app_current_user_id()
    OR app_user_engages_business(id)
  );--> statement-breakpoint
CREATE POLICY businesses_insert ON businesses
  FOR INSERT
  WITH CHECK (owner_user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY businesses_update ON businesses
  FOR UPDATE
  USING (owner_user_id = app_current_user_id())
  WITH CHECK (owner_user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY businesses_delete ON businesses
  FOR DELETE
  USING (owner_user_id = app_current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON businesses TO app_user;--> statement-breakpoint

-- business_vat_status_history: append-only audit; read via business access.
ALTER TABLE business_vat_status_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY bvsh_select ON business_vat_status_history
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY bvsh_insert ON business_vat_status_history
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND changed_by_user_id = app_current_user_id()
  );--> statement-breakpoint
GRANT SELECT, INSERT ON business_vat_status_history TO app_user;--> statement-breakpoint

-- accountant_engagements: business owner manages; engaged accountant can
-- see and accept/revoke their own row.
ALTER TABLE accountant_engagements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY engagements_select ON accountant_engagements
  FOR SELECT
  USING (
    accountant_user_id = app_current_user_id()
    OR app_user_owns_business(business_id)
  );--> statement-breakpoint
CREATE POLICY engagements_insert ON accountant_engagements
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY engagements_update ON accountant_engagements
  FOR UPDATE
  USING (
    app_user_owns_business(business_id)
    OR accountant_user_id = app_current_user_id()
  )
  WITH CHECK (
    app_user_owns_business(business_id)
    OR accountant_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY engagements_delete ON accountant_engagements
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON accountant_engagements TO app_user;--> statement-breakpoint

-- subscriptions: self only.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY subscriptions_self ON subscriptions
  FOR ALL
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON subscriptions TO app_user;--> statement-breakpoint

-- notifications: self only.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY notifications_self ON notifications
  FOR ALL
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO app_user;--> statement-breakpoint

-- plans + plan_entitlements: public read-only.
GRANT SELECT ON plans TO app_user;--> statement-breakpoint
GRANT SELECT ON plan_entitlements TO app_user;--> statement-breakpoint

-- Service-role-only tables: auth_events, rate_limit_buckets,
-- data_encryption_keys. app_service has ALL via 0001 default privileges;
-- app_user is explicitly denied. Use ENABLE RLS as a belt-and-suspenders
-- defense in case a future migration accidentally GRANTs the table.
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE data_encryption_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON auth_events FROM app_user;--> statement-breakpoint
REVOKE ALL ON rate_limit_buckets FROM app_user;--> statement-breakpoint
REVOKE ALL ON data_encryption_keys FROM app_user;
