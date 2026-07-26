-- 0013_receipt_external_ref.sql
--
-- Processor-sync ingest needs a stable, queryable handle on the
-- processor-side receipt id ("externalId") so the cron can skip rows
-- it already imported. The previous code probed
-- `metadata_jsonb->>'externalId'` against a column that never existed
-- (`receipts.metadata_jsonb`), so the dedup query crashed the first
-- time the cron ran and the whole transaction rolled back — net effect:
-- nothing ever persisted.
--
-- This migration:
--   1. Adds `external_ref text` to receipts.
--   2. Backfills nothing (no rows exist yet in this column).
--   3. Adds a partial unique index over
--      (business_id, source, external_ref) so a re-run of the cron
--      against the same processor receipt is a no-op rather than a
--      duplicate.

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS external_ref text;

-- Only enforce uniqueness when the ref is present and the source is
-- the processor-sync ingest path. Manually-uploaded receipts have
-- `source='manual'` and never populate this column.
CREATE UNIQUE INDEX IF NOT EXISTS receipts_external_ref_idx
  ON receipts (business_id, source, external_ref)
  WHERE external_ref IS NOT NULL;
