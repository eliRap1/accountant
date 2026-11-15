-- Layer 3 RLS — tax filings + payroll + compliance.
--
-- 13 net-new tables from 0007. The other two Layer-3 tables
-- (recurring_invoice_templates, invoice_reminders) already have RLS
-- enabled by 0005_rls_layer2.sql; we do NOT redeclare policies for
-- them here.
--
-- Pattern (unchanged from 0003 / 0005):
--   * existing SECURITY DEFINER helpers app_user_can_access_business /
--     app_user_owns_business / app_user_engages_business are reused;
--     no new helper required for this layer.
--   * child tables (form_101_declarations, pension_contributions,
--     severance_provisions) gate access via EXISTS on their parent
--     (payroll_employees / payroll_runs), which in turn gates on
--     businesses.business_id.
--   * step-up requirements (enforced at app layer, not DB):
--       - tax_filings: download requires step-up via filing.export_*;
--                       submit requires step-up + owner-only.
--       - audit_packages: INSERT/SELECT-of-file requires step-up via
--                          op=audit.build_package (registry add pending
--                          in lib/auth/stepUp.ts).
--       - supplier_wht_rates / payroll_employees / payroll_runs /
--         form_101_declarations: ciphertext decrypt path requires
--         step-up via pii.decrypt_* (registry already covers).
--
-- Status transitions on tax_filings.status are NOT enforced at the DB
-- (would require a state-machine trigger). App-layer guard lives in
-- lib/filings/*; the DB simply stores the value chosen by app code.

-- ============================================================================
-- tax_filings — read for engaged accountants; writes for owner; submit
-- + downloaded must be step-up gated at the app layer.
-- ============================================================================
ALTER TABLE tax_filings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tax_filings_select ON tax_filings
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY tax_filings_insert ON tax_filings
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND generated_by_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY tax_filings_update ON tax_filings
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY tax_filings_delete ON tax_filings
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_filings TO app_user;--> statement-breakpoint

-- ============================================================================
-- tax_advances
-- ============================================================================
ALTER TABLE tax_advances ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tax_advances_select ON tax_advances
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY tax_advances_insert ON tax_advances
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY tax_advances_update ON tax_advances
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY tax_advances_delete ON tax_advances
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_advances TO app_user;--> statement-breakpoint

-- ============================================================================
-- client_wht_certificates — gated through clients.business_id (parent table).
-- ============================================================================
ALTER TABLE client_wht_certificates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY client_wht_certificates_select ON client_wht_certificates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_wht_certificates.client_id
        AND app_user_can_access_business(clients.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY client_wht_certificates_insert ON client_wht_certificates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_wht_certificates.client_id
        AND app_user_owns_business(clients.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY client_wht_certificates_update ON client_wht_certificates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_wht_certificates.client_id
        AND app_user_owns_business(clients.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_wht_certificates.client_id
        AND app_user_owns_business(clients.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY client_wht_certificates_delete ON client_wht_certificates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = client_wht_certificates.client_id
        AND app_user_owns_business(clients.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON client_wht_certificates TO app_user;--> statement-breakpoint

-- ============================================================================
-- supplier_wht_rates
-- ============================================================================
ALTER TABLE supplier_wht_rates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY supplier_wht_rates_select ON supplier_wht_rates
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY supplier_wht_rates_insert ON supplier_wht_rates
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY supplier_wht_rates_update ON supplier_wht_rates
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY supplier_wht_rates_delete ON supplier_wht_rates
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_wht_rates TO app_user;--> statement-breakpoint

-- ============================================================================
-- payroll_employees
-- ============================================================================
ALTER TABLE payroll_employees ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payroll_employees_select ON payroll_employees
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_employees_insert ON payroll_employees
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_employees_update ON payroll_employees
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_employees_delete ON payroll_employees
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_employees TO app_user;--> statement-breakpoint

-- ============================================================================
-- payroll_runs
-- ============================================================================
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payroll_runs_select ON payroll_runs
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_runs_insert ON payroll_runs
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_runs_update ON payroll_runs
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY payroll_runs_delete ON payroll_runs
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO app_user;--> statement-breakpoint

-- ============================================================================
-- form_101_declarations — gated through payroll_employees.business_id.
-- 7-yr retention rules are enforced by IL Income Tax Ordinance § 130 and
-- by the DEK lifecycle (retire-not-delete), not by a DB constraint.
-- ============================================================================
ALTER TABLE form_101_declarations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY form_101_declarations_select ON form_101_declarations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payroll_employees
      WHERE payroll_employees.id = form_101_declarations.payroll_employee_id
        AND app_user_can_access_business(payroll_employees.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY form_101_declarations_insert ON form_101_declarations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_employees
      WHERE payroll_employees.id = form_101_declarations.payroll_employee_id
        AND app_user_owns_business(payroll_employees.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY form_101_declarations_update ON form_101_declarations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM payroll_employees
      WHERE payroll_employees.id = form_101_declarations.payroll_employee_id
        AND app_user_owns_business(payroll_employees.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_employees
      WHERE payroll_employees.id = form_101_declarations.payroll_employee_id
        AND app_user_owns_business(payroll_employees.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY form_101_declarations_delete ON form_101_declarations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM payroll_employees
      WHERE payroll_employees.id = form_101_declarations.payroll_employee_id
        AND app_user_owns_business(payroll_employees.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON form_101_declarations TO app_user;--> statement-breakpoint

-- ============================================================================
-- pension_contributions — gated through payroll_runs.business_id.
-- ============================================================================
ALTER TABLE pension_contributions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pension_contributions_select ON pension_contributions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs
      WHERE payroll_runs.id = pension_contributions.payroll_run_id
        AND app_user_can_access_business(payroll_runs.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY pension_contributions_insert ON pension_contributions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_runs
      WHERE payroll_runs.id = pension_contributions.payroll_run_id
        AND app_user_owns_business(payroll_runs.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY pension_contributions_update ON pension_contributions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs
      WHERE payroll_runs.id = pension_contributions.payroll_run_id
        AND app_user_owns_business(payroll_runs.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_runs
      WHERE payroll_runs.id = pension_contributions.payroll_run_id
        AND app_user_owns_business(payroll_runs.business_id)
    )
  );--> statement-breakpoint
CREATE POLICY pension_contributions_delete ON pension_contributions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs
      WHERE payroll_runs.id = pension_contributions.payroll_run_id
        AND app_user_owns_business(payroll_runs.business_id)
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pension_contributions TO app_user;--> statement-breakpoint

-- ============================================================================
-- severance_provisions — direct business_id on this table.
-- ============================================================================
ALTER TABLE severance_provisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY severance_provisions_select ON severance_provisions
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY severance_provisions_insert ON severance_provisions
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY severance_provisions_update ON severance_provisions
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY severance_provisions_delete ON severance_provisions
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON severance_provisions TO app_user;--> statement-breakpoint

-- ============================================================================
-- owner_compensation — owner-only (engaged accountants see, owner mutates).
-- The ח.פ.-only constraint (entity_type='hevra_baam') is enforced at the
-- app layer, not DB, because it depends on a businesses row lookup that
-- a row-level CHECK cannot express without an inner query.
-- ============================================================================
ALTER TABLE owner_compensation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY owner_compensation_select ON owner_compensation
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY owner_compensation_insert ON owner_compensation
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND owner_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY owner_compensation_update ON owner_compensation
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY owner_compensation_delete ON owner_compensation
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_compensation TO app_user;--> statement-breakpoint

-- ============================================================================
-- risk_flags — generators write via service role, but app_user can
-- mark resolved. We allow INSERT for owners + service role; UPDATE for
-- engaged accountants (so a CPA can clear flags during review).
-- ============================================================================
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY risk_flags_select ON risk_flags
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY risk_flags_insert ON risk_flags
  FOR INSERT
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY risk_flags_update ON risk_flags
  FOR UPDATE
  USING (app_user_can_access_business(business_id))
  WITH CHECK (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY risk_flags_delete ON risk_flags
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON risk_flags TO app_user;--> statement-breakpoint

-- ============================================================================
-- inventory_counts
-- ============================================================================
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY inventory_counts_select ON inventory_counts
  FOR SELECT
  USING (app_user_can_access_business(business_id));--> statement-breakpoint
CREATE POLICY inventory_counts_insert ON inventory_counts
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND counted_by_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY inventory_counts_update ON inventory_counts
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY inventory_counts_delete ON inventory_counts
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_counts TO app_user;--> statement-breakpoint

-- ============================================================================
-- audit_packages — INSERT requires step-up at the app layer (op =
-- audit.build_package). The DB does NOT enforce step-up; it enforces
-- only the row-level access. The app-side guard lives in the API route
-- that builds the package (Plan v4 § Audit Package Builder).
--
-- Read is owner-only to keep the artifact under the user who triggered
-- the build; engaged accountants do NOT see audit packages because
-- the package can include their own engagement audit trail and we
-- want to avoid a circular reveal. (Council § 8 raised this question;
-- conservative resolution: owner-only.)
-- ============================================================================
ALTER TABLE audit_packages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_packages_select ON audit_packages
  FOR SELECT
  USING (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY audit_packages_insert ON audit_packages
  FOR INSERT
  WITH CHECK (
    app_user_owns_business(business_id)
    AND generated_by_user_id = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY audit_packages_update ON audit_packages
  FOR UPDATE
  USING (app_user_owns_business(business_id))
  WITH CHECK (app_user_owns_business(business_id));--> statement-breakpoint
CREATE POLICY audit_packages_delete ON audit_packages
  FOR DELETE
  USING (app_user_owns_business(business_id));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_packages TO app_user;
