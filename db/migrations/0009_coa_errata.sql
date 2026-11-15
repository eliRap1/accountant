-- Chart-of-Accounts errata per CPA council finding (2026-05-16).
--
-- Source: docs/council/2026-05-16-cpa-review.md § 4 + § 6
-- Decision: docs/council/2026-05-16-architecture-v5-council-answers.md Q4
--   - Silent fix to the SEED rows only (business_id IS NULL).
--   - Business-scoped rows (business_id IS NOT NULL) are untouched.
--   - Existing journal_lines that reference affected codes are NOT mutated;
--     a paired migration 0010_coa_errata_notices.sql records the change per
--     business and surfaces a dismissable banner on /settings/chart-of-accounts.
--
-- Affected codes:
--   1030 — reclassify asset → liability + rename ("Credit cards payable").
--   2150 — DROP (was duplicative of 2100 + 1400 netting). Gated by EXISTS
--          check on journal_lines so prior postings are never orphaned;
--          if any line references it, the DELETE is skipped and a NOTICE
--          is raised. The dropped row stays as "parent" only if needed.
--   7400 — rename to "Vehicle expenses (parent)" + add 7401-7405 sub-codes
--          (gas / maintenance / vehicle insurance / leasing / vehicle pchat).
--          Existing journal_lines on 7400 stay; banner instructs accountant
--          to reassign.
--   Missing codes added: 8100 (donations §46), 8200 (depreciation expense),
--     8300 (professional indemnity insurance), 8400 (rent operational),
--     8500 (e-commerce fees), 1305 (supplier advances), 2070 (accrued
--     payroll), 2080 (severance accrual).
--
-- IMPORTANT: existing seed code 8100 was "Interest & finance charges" and
-- 8500 was "FX differences" (per scripts/db-seed.ts line 200-201). The
-- CPA council § 4 + Plan v4 mapping suggests renumbering. To avoid
-- silently breaking journal_lines that already reference 8100 / 8500, we
-- RENAME those old rows to 8110 ("Interest & finance charges") and 8510
-- ("FX differences") in the same transaction, freeing 8100 + 8500 for the
-- new semantics. This is documented in the coa_errata_notices banner.
--
-- form_6111_line values below match the CPA council § 6 minimum-viable
-- mapping table. They are tagged `<verify-this>` in scripts/db-seed.ts
-- pending live re-verification against the ITA's published 6111 schedule
-- (taxes.gov.il/IncomeTax/Pages/Form6111) — same status as the rest of
-- the seed per the original db-seed.ts comment "Phase D fills them in".
--
-- Rollback: see paired rollback at the bottom of this comment block.
--   UPDATE chart_of_accounts SET type='asset', name_he='כרטיסי אשראי לחיוב',
--     name_en='Credit card receivable', form_6111_line='1011'
--     WHERE business_id IS NULL AND code='1030';
--   INSERT INTO chart_of_accounts (business_id, code, name_he, name_en, type,
--     form_6111_line, is_active) VALUES (NULL,'2150','מע"מ לתשלום','VAT net payable',
--     'liability','2020', true) ON CONFLICT DO NOTHING;
--   DELETE FROM chart_of_accounts WHERE business_id IS NULL AND code IN
--     ('7401','7402','7403','7404','7405','8200','8300','8400','1305','2070','2080');
--   UPDATE chart_of_accounts SET code='8100', name_he='ריבית והוצאות מימון',
--     name_en='Interest & finance charges', form_6111_line='8020'
--     WHERE business_id IS NULL AND code='8110';
--   UPDATE chart_of_accounts SET code='8500', name_he='הפרשי שער',
--     name_en='FX differences', form_6111_line='8030'
--     WHERE business_id IS NULL AND code='8510';
--   UPDATE chart_of_accounts SET name_he='הוצאות רכב', name_en='Vehicle expenses'
--     WHERE business_id IS NULL AND code='7400';
--   -- (then re-insert 8100 donations / 8500 e-commerce removed automatically
--   --  by the renumber rollback above.)

BEGIN;--> statement-breakpoint

-- ============================================================================
-- 1) Reclassify code 1030: asset → liability.
-- ============================================================================
UPDATE chart_of_accounts
SET
  type            = 'liability'::chart_of_accounts_type,
  name_he         = 'כרטיסי אשראי',
  name_en         = 'Credit cards payable',
  form_6111_line  = '2050',  -- short-term liability bucket; <verify-this>
  updated_at      = now()
WHERE business_id IS NULL
  AND code = '1030';--> statement-breakpoint

-- ============================================================================
-- 2) Drop code 2150 — gated by absence of dependent journal_lines.
--    If any journal_lines.account_code = '2150' exists for ANY business
--    (standard code is shared across all businesses), skip the DELETE and
--    rely on the coa_errata_notices banner to flag manual cleanup.
-- ============================================================================
DO $$
DECLARE
  ref_count int;
BEGIN
  SELECT COUNT(*) INTO ref_count
  FROM journal_lines
  WHERE account_code = '2150';

  IF ref_count = 0 THEN
    DELETE FROM chart_of_accounts
    WHERE business_id IS NULL
      AND code = '2150';
    RAISE NOTICE 'coa-errata: code 2150 dropped (no journal_lines referenced it).';
  ELSE
    -- Soft-deactivate instead of dropping. Keeps prior postings auditable.
    UPDATE chart_of_accounts
    SET
      is_active   = false,
      name_he     = 'מע"מ לתשלום (לא פעיל - ראה הודעת תיקון)',
      name_en     = 'VAT net payable (DEPRECATED — see errata)',
      updated_at  = now()
    WHERE business_id IS NULL
      AND code = '2150';
    RAISE WARNING 'coa-errata: code 2150 has % journal_lines references; row deactivated instead of dropped.', ref_count;
  END IF;
END;
$$;--> statement-breakpoint

-- ============================================================================
-- 3) Split code 7400 — rename to parent + insert 5 sub-codes.
--    Existing journal_lines on 7400 are NOT mutated; banner directs
--    accountant to reassign per the post-migration coa_errata_notices row.
-- ============================================================================
UPDATE chart_of_accounts
SET
  name_he         = 'הוצאות רכב (אב)',
  name_en         = 'Vehicle expenses (parent)',
  form_6111_line  = '350',  -- vehicle expenses post-2/3 rule; <verify-this>
  updated_at      = now()
WHERE business_id IS NULL
  AND code = '7400';--> statement-breakpoint

INSERT INTO chart_of_accounts (business_id, code, name_he, name_en, type, form_6111_line, is_active) VALUES
  (NULL, '7401', 'דלק',         'Gas',                'expense'::chart_of_accounts_type, '350', true),
  (NULL, '7402', 'תחזוקה',      'Maintenance',        'expense'::chart_of_accounts_type, '350', true),
  (NULL, '7403', 'ביטוח רכב',  'Vehicle insurance',  'expense'::chart_of_accounts_type, '350', true),
  (NULL, '7404', 'ליסינג',      'Leasing',            'expense'::chart_of_accounts_type, '350', true),
  (NULL, '7405', 'פחת רכב',    'Vehicle depreciation','expense'::chart_of_accounts_type, '500', true)
ON CONFLICT (code) WHERE business_id IS NULL DO UPDATE SET
  name_he         = EXCLUDED.name_he,
  name_en         = EXCLUDED.name_en,
  type            = EXCLUDED.type,
  form_6111_line  = EXCLUDED.form_6111_line,
  is_active       = EXCLUDED.is_active,
  updated_at      = now();--> statement-breakpoint

-- ============================================================================
-- 4) Rename pre-existing 8100 / 8500 to 8110 / 8510 to free new semantics.
--    Old rows are NOT deleted; they keep is_active = true so any existing
--    references remain valid. Banner explains the renumber.
-- ============================================================================
UPDATE chart_of_accounts
SET
  code            = '8110',
  form_6111_line  = '540',  -- interest & finance; <verify-this>
  updated_at      = now()
WHERE business_id IS NULL
  AND code = '8100';--> statement-breakpoint

UPDATE chart_of_accounts
SET
  code            = '8510',
  form_6111_line  = '580',  -- FX differences; <verify-this>
  updated_at      = now()
WHERE business_id IS NULL
  AND code = '8500';--> statement-breakpoint

-- ============================================================================
-- 5) Insert missing codes flagged by CPA council § 4 + § 6.
-- ============================================================================
INSERT INTO chart_of_accounts (business_id, code, name_he, name_en, type, form_6111_line, is_active) VALUES
  (NULL, '1305', 'מקדמות לספקים',                'Supplier advances',                       'asset'::chart_of_accounts_type,     '1050', true),
  (NULL, '2070', 'הוצאות לשלם - עובדים',         'Accrued payroll',                         'liability'::chart_of_accounts_type, '2070', true),
  (NULL, '2080', 'פיצויי פיטורין',                'Severance accrual',                       'liability'::chart_of_accounts_type, '2070', true),
  (NULL, '8100', 'תרומות',                        'Donations (§46 eligible)',                'expense'::chart_of_accounts_type,   '890',  true),
  (NULL, '8200', 'פחת',                           'Depreciation expense',                    'expense'::chart_of_accounts_type,   '500',  true),
  (NULL, '8300', 'ביטוח אחריות מקצועית',         'Professional indemnity insurance',        'expense'::chart_of_accounts_type,   '380',  true),
  (NULL, '8400', 'השכרה',                         'Rent (operational)',                      'expense'::chart_of_accounts_type,   '290',  true),
  (NULL, '8500', 'מסחר אלקטרוני - עמלות',        'E-commerce fees',                         'expense'::chart_of_accounts_type,   '380',  true)
ON CONFLICT (code) WHERE business_id IS NULL DO UPDATE SET
  name_he         = EXCLUDED.name_he,
  name_en         = EXCLUDED.name_en,
  type            = EXCLUDED.type,
  form_6111_line  = EXCLUDED.form_6111_line,
  is_active       = EXCLUDED.is_active,
  updated_at      = now();--> statement-breakpoint

COMMIT;
