-- Layer 2 RLS — clients + ledger + invoicing + money-flows.
--
-- Same pattern as 0003: SECURITY DEFINER helpers owned by neondb_owner so
-- table-owner-bypasses-RLS short-circuits policy recursion. The Layer 1
-- helpers app_user_owns_business / app_user_engages_business / app_user_can_access_business
-- are reused here; only one new helper is introduced (app_period_is_closed).
--
-- Step-up requirements (enforced in app code, not DB):
--   * processor_sync_credentials.api_key_ciphertext  → decrypt requires step-up
--   * year_end_closes INSERT / DELETE                → service role only
--   * journal_entries with entry_date inside a closed period → blocked by
--     app code consulting app_period_is_closed(business_id, entry_date).

-- ============================================================================
-- Helper: returns true if (business_id, date) falls inside a closed fiscal
-- year for that business. App-layer guards consult this before allowing a
-- journal_entries write whose entry_date falls into the period.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_period_is_closed(b_id uuid, d date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM year_end_closes
    WHERE business_id = b_id
      AND fiscal_year = EXTRACT(YEAR FROM d)::integer
  )
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_period_is_closed(uuid, date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_period_is_closed(uuid, date) TO app_user, app_service;--> statement-breakpoint

-- ============================================================================
-- Journal balance trigger: enforce sum(debit_minor) = sum(credit_minor) per
-- entry on INSERT / UPDATE / DELETE of journal_lines. SECURITY DEFINER so
-- the trigger body can read the entry's full set of lines regardless of
-- the calling role's RLS policies (the trigger is owned by neondb_owner,
-- which bypasses RLS as the table owner).
--
-- Closing-of-year entries that intentionally unbalance are written under
-- session_replication_role = 'replica' inside the close transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION app_assert_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_entry uuid;
  debit_sum bigint;
  credit_sum bigint;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    target_entry := OLD.entry_id;
  ELSE
    target_entry := NEW.entry_id;
  END IF;

  SELECT
    COALESCE(SUM(debit_minor), 0),
    COALESCE(SUM(credit_minor), 0)
  INTO debit_sum, credit_sum
  FROM journal_lines
  WHERE entry_id = target_entry;

  IF debit_sum <> credit_sum THEN
    RAISE EXCEPTION 'journal_lines: unbalanced entry % (debits=%, credits=%)',
      target_entry, debit_sum, credit_sum;
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_assert_journal_balance() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_assert_journal_balance() TO app_user, app_service;--> statement-breakpoint

-- DEFERRABLE INITIALLY DEFERRED so multi-line entries can build up within
-- a transaction and the balance check runs at COMMIT. CONSTRAINT triggers
-- in Postgres require this to be a constraint trigger.
CREATE CONSTRAINT TRIGGER journal_lines_balance_check
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_assert_journal_balance();--> statement-breakpoint

-- ============================================================================
-- clients
-- ============================================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY clients_select ON clients
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY clients_insert ON clients
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY clients_update ON clients
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY clients_delete ON clients
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO app_user;--> statement-breakpoint

-- ============================================================================
-- financial_accounts
-- ============================================================================
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY financial_accounts_select ON financial_accounts
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY financial_accounts_insert ON financial_accounts
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY financial_accounts_update ON financial_accounts
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY financial_accounts_delete ON financial_accounts
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_accounts TO app_user;--> statement-breakpoint

-- ============================================================================
-- journal_entries
-- ============================================================================
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_entries_select ON journal_entries
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY journal_entries_insert ON journal_entries
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY journal_entries_update ON journal_entries
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY journal_entries_delete ON journal_entries
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO app_user;--> statement-breakpoint

-- ============================================================================
-- journal_lines — gated through parent journal_entries.business_id
-- ============================================================================
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_lines_select ON journal_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = journal_lines.entry_id
        AND app_user_can_access_business(journal_entries.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY journal_lines_insert ON journal_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = journal_lines.entry_id
        AND app_user_owns_business(journal_entries.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY journal_lines_update ON journal_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = journal_lines.entry_id
        AND app_user_owns_business(journal_entries.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = journal_lines.entry_id
        AND app_user_owns_business(journal_entries.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY journal_lines_delete ON journal_lines
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM journal_entries
      WHERE journal_entries.id = journal_lines.entry_id
        AND app_user_owns_business(journal_entries.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_lines TO app_user;--> statement-breakpoint

-- ============================================================================
-- chart_of_accounts — public read for standard codes; per-business writes.
-- ============================================================================
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY chart_of_accounts_select ON chart_of_accounts
  FOR SELECT
  USING (
    business_id IS NULL
    OR app_user_can_access_business(business_id)
  );--> statement-breakpoint
CREATE POLICY chart_of_accounts_insert ON chart_of_accounts
  FOR INSERT
  WITH CHECK (
    business_id IS NOT NULL
    AND app_user_owns_business(business_id)
  );--> statement-breakpoint
CREATE POLICY chart_of_accounts_update ON chart_of_accounts
  FOR UPDATE
  USING (
    business_id IS NOT NULL
    AND app_user_owns_business(business_id)
  )
  WITH CHECK (
    business_id IS NOT NULL
    AND app_user_owns_business(business_id)
  );--> statement-breakpoint
CREATE POLICY chart_of_accounts_delete ON chart_of_accounts
  FOR DELETE
  USING (
    business_id IS NOT NULL
    AND app_user_owns_business(business_id)
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON chart_of_accounts TO app_user;--> statement-breakpoint

-- ============================================================================
-- opening_balances
-- ============================================================================
ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY opening_balances_select ON opening_balances
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY opening_balances_insert ON opening_balances
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY opening_balances_update ON opening_balances
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY opening_balances_delete ON opening_balances
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON opening_balances TO app_user;--> statement-breakpoint

-- ============================================================================
-- year_end_closes — read for engaged accountants; insert/delete service-role
-- only (handled by REVOKE; no INSERT/DELETE policy means writes from app_user
-- are always denied even if a future migration accidentally GRANTed them).
-- ============================================================================
ALTER TABLE year_end_closes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY year_end_closes_select ON year_end_closes
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
GRANT SELECT ON year_end_closes TO app_user;--> statement-breakpoint

-- ============================================================================
-- financial_statements
-- ============================================================================
ALTER TABLE financial_statements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY financial_statements_select ON financial_statements
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY financial_statements_insert ON financial_statements
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY financial_statements_update ON financial_statements
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY financial_statements_delete ON financial_statements
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_statements TO app_user;--> statement-breakpoint

-- ============================================================================
-- fx_revaluation_runs
-- ============================================================================
ALTER TABLE fx_revaluation_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fx_revaluation_runs_select ON fx_revaluation_runs
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY fx_revaluation_runs_insert ON fx_revaluation_runs
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY fx_revaluation_runs_update ON fx_revaluation_runs
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY fx_revaluation_runs_delete ON fx_revaluation_runs
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON fx_revaluation_runs TO app_user;--> statement-breakpoint

-- ============================================================================
-- invoices
-- ============================================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoices_select ON invoices
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY invoices_insert ON invoices
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY invoices_update ON invoices
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY invoices_delete ON invoices
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_user;--> statement-breakpoint

-- ============================================================================
-- invoice_line_items — gated through parent invoices.business_id
-- ============================================================================
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoice_line_items_select ON invoice_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
        AND app_user_can_access_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_line_items_insert ON invoice_line_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_line_items_update ON invoice_line_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_line_items_delete ON invoice_line_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_line_items.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_line_items TO app_user;--> statement-breakpoint

-- ============================================================================
-- invoice_sequence_audit
-- ============================================================================
ALTER TABLE invoice_sequence_audit ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoice_sequence_audit_select ON invoice_sequence_audit
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY invoice_sequence_audit_insert ON invoice_sequence_audit
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND actor_user_id = app_current_user_id()
  );--> statement-breakpoint
GRANT SELECT, INSERT ON invoice_sequence_audit TO app_user;--> statement-breakpoint

-- ============================================================================
-- recurring_invoice_templates
-- ============================================================================
ALTER TABLE recurring_invoice_templates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY recurring_invoice_templates_select ON recurring_invoice_templates
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY recurring_invoice_templates_insert ON recurring_invoice_templates
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY recurring_invoice_templates_update ON recurring_invoice_templates
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY recurring_invoice_templates_delete ON recurring_invoice_templates
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_invoice_templates TO app_user;--> statement-breakpoint

-- ============================================================================
-- invoice_reminders — gated through parent invoices.business_id
-- ============================================================================
ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invoice_reminders_select ON invoice_reminders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_reminders.invoice_id
        AND app_user_can_access_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_reminders_insert ON invoice_reminders
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_reminders.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_reminders_update ON invoice_reminders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_reminders.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_reminders.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY invoice_reminders_delete ON invoice_reminders
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_reminders.invoice_id
        AND app_user_owns_business(invoices.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_reminders TO app_user;--> statement-breakpoint

-- ============================================================================
-- transactions
-- ============================================================================
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY transactions_select ON transactions
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY transactions_insert ON transactions
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY transactions_update ON transactions
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY transactions_delete ON transactions
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO app_user;--> statement-breakpoint

-- ============================================================================
-- receipts
-- ============================================================================
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY receipts_select ON receipts
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY receipts_insert ON receipts
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY receipts_update ON receipts
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY receipts_delete ON receipts
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON receipts TO app_user;--> statement-breakpoint

-- ============================================================================
-- bank_statement_imports
-- ============================================================================
ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY bank_statement_imports_select ON bank_statement_imports
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY bank_statement_imports_insert ON bank_statement_imports
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND imported_by_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY bank_statement_imports_update ON bank_statement_imports
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY bank_statement_imports_delete ON bank_statement_imports
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_statement_imports TO app_user;--> statement-breakpoint

-- ============================================================================
-- bank_reconciliations
-- ============================================================================
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY bank_reconciliations_select ON bank_reconciliations
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY bank_reconciliations_insert ON bank_reconciliations
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY bank_reconciliations_update ON bank_reconciliations
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY bank_reconciliations_delete ON bank_reconciliations
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_reconciliations TO app_user;--> statement-breakpoint

-- ============================================================================
-- processor_sync_credentials — api_key_ciphertext decrypt requires step-up
-- (enforced at app layer; DB just protects the row).
-- ============================================================================
ALTER TABLE processor_sync_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY processor_sync_credentials_select ON processor_sync_credentials
  FOR SELECT
  USING (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY processor_sync_credentials_insert ON processor_sync_credentials
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY processor_sync_credentials_update ON processor_sync_credentials
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY processor_sync_credentials_delete ON processor_sync_credentials
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON processor_sync_credentials TO app_user;
