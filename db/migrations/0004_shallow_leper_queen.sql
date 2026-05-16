CREATE TYPE "public"."chart_of_accounts_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."financial_account_kind" AS ENUM('bank', 'cash', 'credit_card', 'loan', 'equity', 'other');--> statement-breakpoint
CREATE TYPE "public"."financial_statement_kind" AS ENUM('balance_sheet', 'profit_loss', 'cash_flow');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_source" AS ENUM('manual', 'invoice', 'payment', 'bank_import', 'processor_sync', 'payroll_run', 'year_end_close', 'fx_revaluation');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('not_required', 'required_not_assigned', 'manual_pasted', 'partner_issued', 'processor_synced', 'direct_shaam');--> statement-breakpoint
CREATE TYPE "public"."invoice_sequence_outcome" AS ENUM('committed', 'rolled_back', 'gap_detected');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_note', 'proforma', 'debit_note', 'self_invoice');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('internal', 'greenInvoice', 'iCount', 'ezCount', 'hyp', 'grow', 'payplus', 'direct_shaam');--> statement-breakpoint
CREATE TYPE "public"."bank_format" AS ENUM('leumi_pdf', 'hapoalim_csv', 'mizrahi_xlsx', 'discount_csv', 'ofx', 'csv', 'greeninvoice_csv');--> statement-breakpoint
CREATE TYPE "public"."bank_import_status" AS ENUM('pending', 'committed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."processor" AS ENUM('hyp', 'grow', 'payplus');--> statement-breakpoint
CREATE TYPE "public"."receipt_source" AS ENUM('upload', 'email_in', 'manual', 'processor_sync');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'bank_import', 'processor_sync', 'ocr', 'journal');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"vat_id" text,
	"email_ciphertext" text,
	"phone_ciphertext" text,
	"address_street" text,
	"address_city" text,
	"address_postal_code" text,
	"address_country" text,
	"default_payment_terms_days" integer DEFAULT 14 NOT NULL,
	"default_currency" text DEFAULT 'ILS' NOT NULL,
	"notes_ciphertext" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"code" text NOT NULL,
	"name_he" text,
	"name_en" text,
	"type" chart_of_accounts_type NOT NULL,
	"form_6111_line" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "financial_account_kind" NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"closed_at" timestamp,
	"external_account_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "financial_statement_kind" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"totals_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_ciphertext" text,
	"file_key_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_revaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"adjustment_entry_id" uuid,
	"fx_rates_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"description" text,
	"source" "journal_entry_source" NOT NULL,
	"posted_at" timestamp DEFAULT now() NOT NULL,
	"reversed_by_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"fx_rate" numeric(18, 8),
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_xor_debit_credit" CHECK (("journal_lines"."debit_minor" > 0 AND "journal_lines"."credit_minor" = 0) OR ("journal_lines"."debit_minor" = 0 AND "journal_lines"."credit_minor" > 0)),
	CONSTRAINT "journal_lines_nonnegative_nonzero" CHECK ("journal_lines"."debit_minor" >= 0 AND "journal_lines"."credit_minor" >= 0 AND ("journal_lines"."debit_minor" + "journal_lines"."credit_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "opening_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"balance_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"closed_at" timestamp DEFAULT now() NOT NULL,
	"closed_by_user_id" uuid NOT NULL,
	"close_journal_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"vat_rate" numeric(4, 2) NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"linked_inventory_item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"sent_at" timestamp,
	"kind" text NOT NULL,
	"email_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequence_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_type" "invoice_type" NOT NULL,
	"attempted_sequence" integer NOT NULL,
	"outcome" "invoice_sequence_outcome" NOT NULL,
	"committed_invoice_id" uuid,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid,
	"invoice_type" "invoice_type" NOT NULL,
	"sequential_number" integer NOT NULL,
	"parent_invoice_id" uuid,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"issue_date" date NOT NULL,
	"due_date" date,
	"subtotal_minor" bigint NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"vat_rate" numeric(4, 2) NOT NULL,
	"currency_at_issue" text DEFAULT 'ILS' NOT NULL,
	"fx_rate_at_issue" numeric(18, 8),
	"allocation_number" text,
	"allocation_status" "allocation_status" DEFAULT 'not_required' NOT NULL,
	"allocation_required_at_issue" boolean NOT NULL,
	"provider_kind" "provider_kind" DEFAULT 'internal' NOT NULL,
	"external_invoice_id" text,
	"pcn874_exported_at" timestamp,
	"linked_journal_entry_id" uuid,
	"notes_he" text,
	"notes_en" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "recurring_invoice_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"template_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cadence" text NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_account_id" uuid NOT NULL,
	"statement_period_start" date NOT NULL,
	"statement_period_end" date NOT NULL,
	"ledger_balance_minor" bigint,
	"statement_balance_minor" bigint,
	"adjustments_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reconciled_at" timestamp,
	"reconciled_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"bank" text NOT NULL,
	"source_format" "bank_format" NOT NULL,
	"file_name" text,
	"file_blob_url" text,
	"parsed_transactions_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"status" "bank_import_status" DEFAULT 'pending' NOT NULL,
	"committed_at" timestamp,
	"imported_by_user_id" uuid NOT NULL,
	"error_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processor_sync_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"processor" "processor" NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"synced_doc_kind" text DEFAULT 'receipt' NOT NULL,
	"last_synced_at" timestamp,
	"sync_cursor" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "receipt_status" DEFAULT 'pending_review' NOT NULL,
	"source" "receipt_source" NOT NULL,
	"ocr_text_ciphertext" text,
	"parsed_amount_minor" bigint,
	"parsed_vat_minor" bigint,
	"parsed_date" date,
	"parsed_vendor_ciphertext" text,
	"category_code" text,
	"business_use_pct" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"vat_recoverable_minor" bigint,
	"file_blob_url" text,
	"file_key_id" uuid,
	"linked_transaction_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_account_id" uuid,
	"direction" "transaction_direction" NOT NULL,
	"category_code" text,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"description" text,
	"txn_date" date NOT NULL,
	"linked_invoice_id" uuid,
	"linked_receipt_id" uuid,
	"linked_journal_entry_id" uuid,
	"source" "transaction_source" NOT NULL,
	"source_external_id" text,
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_file_key_id_data_encryption_keys_id_fk" FOREIGN KEY ("file_key_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_adjustment_entry_id_journal_entries_id_fk" FOREIGN KEY ("adjustment_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_id_journal_entries_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_closes" ADD CONSTRAINT "year_end_closes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_closes" ADD CONSTRAINT "year_end_closes_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_closes" ADD CONSTRAINT "year_end_closes_close_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("close_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequence_audit" ADD CONSTRAINT "invoice_sequence_audit_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequence_audit" ADD CONSTRAINT "invoice_sequence_audit_committed_invoice_id_invoices_id_fk" FOREIGN KEY ("committed_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequence_audit" ADD CONSTRAINT "invoice_sequence_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_invoice_id_invoices_id_fk" FOREIGN KEY ("parent_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_linked_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("linked_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_financial_account_id_financial_accounts_id_fk" FOREIGN KEY ("financial_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processor_sync_credentials" ADD CONSTRAINT "processor_sync_credentials_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_file_key_id_data_encryption_keys_id_fk" FOREIGN KEY ("file_key_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_financial_account_id_financial_accounts_id_fk" FOREIGN KEY ("financial_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_linked_invoice_id_invoices_id_fk" FOREIGN KEY ("linked_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_linked_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("linked_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_business_legal_name_idx" ON "clients" USING btree ("business_id","legal_name");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_of_accounts_business_code_idx" ON "chart_of_accounts" USING btree ("business_id","code") WHERE business_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_of_accounts_standard_code_idx" ON "chart_of_accounts" USING btree ("code") WHERE business_id IS NULL;--> statement-breakpoint
CREATE INDEX "chart_of_accounts_code_idx" ON "chart_of_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "financial_accounts_business_idx" ON "financial_accounts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "financial_statements_business_period_idx" ON "financial_statements" USING btree ("business_id","period_end");--> statement-breakpoint
CREATE INDEX "fx_revaluation_runs_business_period_idx" ON "fx_revaluation_runs" USING btree ("business_id","period_end");--> statement-breakpoint
CREATE INDEX "journal_entries_business_date_idx" ON "journal_entries" USING btree ("business_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_code_idx" ON "journal_lines" USING btree ("account_code");--> statement-breakpoint
CREATE UNIQUE INDEX "opening_balances_unique_idx" ON "opening_balances" USING btree ("business_id","account_code","fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_closes_unique_idx" ON "year_end_closes" USING btree ("business_id","fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_items_position_idx" ON "invoice_line_items" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_reminders_pending_idx" ON "invoice_reminders" USING btree ("scheduled_at") WHERE sent_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoice_reminders_invoice_idx" ON "invoice_reminders" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_sequence_audit_business_type_time_idx" ON "invoice_sequence_audit" USING btree ("business_id","invoice_type","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_internal_sequence_idx" ON "invoices" USING btree ("business_id","invoice_type","sequential_number") WHERE provider_kind = 'internal' AND cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_business_issue_date_idx" ON "invoices" USING btree ("business_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_allocation_status_idx" ON "invoices" USING btree ("allocation_status");--> statement-breakpoint
CREATE INDEX "recurring_invoice_templates_business_idx" ON "recurring_invoice_templates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_invoice_templates_next_run_idx" ON "recurring_invoice_templates" USING btree ("next_run_at") WHERE active = true;--> statement-breakpoint
CREATE INDEX "bank_reconciliations_business_period_idx" ON "bank_reconciliations" USING btree ("business_id","statement_period_end");--> statement-breakpoint
CREATE INDEX "bank_statement_imports_business_time_idx" ON "bank_statement_imports" USING btree ("business_id","imported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "processor_sync_credentials_unique_active_idx" ON "processor_sync_credentials" USING btree ("business_id","processor") WHERE active = true;--> statement-breakpoint
CREATE INDEX "receipts_business_status_idx" ON "receipts" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "transactions_business_date_idx" ON "transactions" USING btree ("business_id","txn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_source_external_idx" ON "transactions" USING btree ("source","source_external_id") WHERE source_external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("financial_account_id");