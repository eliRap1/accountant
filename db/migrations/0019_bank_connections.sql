CREATE TABLE bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bank_slug text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT 'stub',
  provider_connection_id text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  metadata_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_connections_business_idx ON bank_connections(business_id);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY bank_connections_select ON bank_connections FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses
      WHERE owner_user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY bank_connections_insert ON bank_connections FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT id FROM businesses
      WHERE owner_user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY bank_connections_update ON bank_connections FOR UPDATE
  USING (
    business_id IN (
      SELECT id FROM businesses
      WHERE owner_user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY bank_connections_delete ON bank_connections FOR DELETE
  USING (
    business_id IN (
      SELECT id FROM businesses
      WHERE owner_user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON bank_connections TO app_user;
