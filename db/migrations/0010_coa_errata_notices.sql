-- coa_errata_notices — dismissable banner state for CoA errata announcements.
--
-- Per council answers Q4 (docs/council/2026-05-16-architecture-v5-council-answers.md):
--   "Silent migration of seed CoA in 0009; per-business coa_errata_notices
--    row + banner on settings page."
--
-- Schema:
--   - One row per (business_id, errata_version). The PK is uuid; the
--     business_id + errata_version combination is uniquely indexed via a
--     partial unique index (active rows only) so retiring a notice and
--     issuing a new one for the same version remains possible.
--   - affected_codes: array of chart-of-accounts code strings touched by
--     this errata version.
--   - notes_jsonb: free-form metadata (e.g. {"renumbered":["8100→8110","8500→8510"]}).
--   - dismissed_at + dismissed_by_user_id: write-once stamp by the owner.
--
-- RLS pattern: matches the rest of the codebase. SELECT via
-- app_user_can_access_business (so engaged accountants can read but cannot
-- dismiss). UPDATE/DELETE restricted to owners only via
-- app_user_owns_business. INSERT is service-role only (the migration writes
-- one row per business; users never insert directly).
--
-- Rollback:
--   DROP TABLE IF EXISTS coa_errata_notices;

BEGIN;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS coa_errata_notices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  errata_version        text NOT NULL,
  introduced_at         timestamp NOT NULL DEFAULT now(),
  dismissed_at          timestamp,
  dismissed_by_user_id  uuid REFERENCES users(id),
  affected_codes        text[] NOT NULL,
  notes_jsonb           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

-- One active notice per (business, version) — dismissal frees the slot.
CREATE UNIQUE INDEX coa_errata_notices_business_version_active_idx
  ON coa_errata_notices (business_id, errata_version)
  WHERE dismissed_at IS NULL;--> statement-breakpoint

-- Active notice lookup index for the banner query.
CREATE INDEX coa_errata_notices_business_idx
  ON coa_errata_notices (business_id)
  WHERE dismissed_at IS NULL;--> statement-breakpoint

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE coa_errata_notices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- SELECT: engagement read — owner + engaged accountants both see the row.
CREATE POLICY coa_errata_notices_select ON coa_errata_notices
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint

-- UPDATE: owner-only dismiss. The WITH CHECK + USING are identical so the
-- update cannot escape ownership via a side effect.
CREATE POLICY coa_errata_notices_update ON coa_errata_notices
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (
    app_user_owns_business(business_id)
    AND (dismissed_by_user_id IS NULL OR dismissed_by_user_id = app_current_user_id())
  );--> statement-breakpoint

-- DELETE: owner only (mostly for ops / future cleanup; users never delete).
CREATE POLICY coa_errata_notices_delete ON coa_errata_notices
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint

-- No INSERT policy ⇒ app_user cannot INSERT regardless of GRANT (RLS denies
-- by default when no policy matches). Service role bypasses via ROLE switch.
GRANT SELECT, UPDATE, DELETE ON coa_errata_notices TO app_user;--> statement-breakpoint

-- ============================================================================
-- Backfill — one row per existing business for the 2026-05-16 errata.
--
-- Affected codes per migration 0009:
--   1030 (reclassified asset→liability)
--   2150 (dropped, or deactivated if journal_lines referenced it)
--   7400 (split into parent + 5 sub-codes 7401-7405)
--   8100, 8500 (renumbered to 8110/8510 → semantics replaced)
--   New: 1305, 2070, 2080, 7401-7405, 8100, 8200, 8300, 8400, 8500
--
-- The backfill is INSERT … ON CONFLICT DO NOTHING so re-running the
-- migration (or running it on a DB that already has the notices) is a no-op.
-- ============================================================================
INSERT INTO coa_errata_notices (business_id, errata_version, affected_codes, notes_jsonb)
SELECT
  b.id,
  '2026-05-16-coa-errata-v1',
  ARRAY[
    '1030', '2150', '7400',
    '7401', '7402', '7403', '7404', '7405',
    '8100', '8200', '8300', '8400', '8500',
    '1305', '2070', '2080'
  ]::text[],
  jsonb_build_object(
    'reclassified',  jsonb_build_array('1030: asset → liability'),
    'dropped_or_deactivated', jsonb_build_array('2150'),
    'split',         jsonb_build_array('7400 → 7400 + 7401..7405'),
    'renumbered',    jsonb_build_array('8100 → 8110 (Interest & finance)', '8500 → 8510 (FX differences)'),
    'added',         jsonb_build_array('1305','2070','2080','7401','7402','7403','7404','7405','8100','8200','8300','8400','8500'),
    'source_doc',    'docs/council/2026-05-16-cpa-review.md § 4'
  )
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM coa_errata_notices n
  WHERE n.business_id = b.id
    AND n.errata_version = '2026-05-16-coa-errata-v1'
);--> statement-breakpoint

COMMIT;
