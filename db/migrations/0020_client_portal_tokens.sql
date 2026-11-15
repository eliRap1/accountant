CREATE TABLE client_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  issued_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX client_portal_tokens_client_idx ON client_portal_tokens(client_id);
CREATE INDEX client_portal_tokens_token_hash_idx ON client_portal_tokens(token_hash);

-- No RLS — issuing happens via service role (we trust the issuing user
-- because the API route resolved the parent business). Lookup happens
-- via service role too (the portal route has no app_user session).
