-- 0015_force_rls.sql
--
-- Defense-in-depth: enable FORCE ROW LEVEL SECURITY on every
-- user-scoped table so the BYPASSRLS attribute on `neondb_owner`
-- doesn't mask a buggy policy in tests or in support scripts that
-- forget to SET LOCAL ROLE app_user. Tables that are intentionally
-- service-role-only (auth_events, rate_limit_buckets,
-- data_encryption_keys, stripe_webhook_events) are NOT forced —
-- the service role IS the only path that reaches them.
--
-- After this migration, every SELECT/INSERT/UPDATE/DELETE goes
-- through the policies regardless of role, except via explicit
-- SECURITY DEFINER helpers (which still bypass).

DO $$
DECLARE
  t text;
  forced_tables text[] := ARRAY[
    'users',
    'accountant_engagements',
    'businesses',
    'business_vat_status_history',
    'notifications',
    'subscriptions',
    'plans',
    'plan_entitlements',
    'clients',
    'financial_accounts',
    'journal_entries',
    'journal_lines',
    'chart_of_accounts',
    'opening_balances',
    'year_end_closes',
    'financial_statements',
    'fx_revaluation_runs',
    'invoices',
    'invoice_line_items',
    'invoice_sequence_audit',
    'recurring_invoice_templates',
    'invoice_reminders',
    'transactions',
    'receipts',
    'bank_statement_imports',
    'bank_reconciliations',
    'processor_sync_credentials',
    'tax_filings',
    'tax_advances',
    'client_wht_certificates',
    'supplier_wht_rates',
    'payroll_employees',
    'payroll_runs',
    'form_101_declarations',
    'pension_contributions',
    'severance_provisions',
    'owner_compensation',
    'risk_flags',
    'inventory_counts',
    'audit_packages',
    'ai_conversations',
    'ai_messages',
    'coa_errata_notices'
  ];
BEGIN
  FOREACH t IN ARRAY forced_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=t
    ) THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
