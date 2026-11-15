CREATE TYPE "public"."tax_filing_kind" AS ENUM('pcn874', 'form_6111', 'form_102', 'form_1301', 'form_1214', 'form_126', 'form_856');--> statement-breakpoint
CREATE TYPE "public"."tax_filing_status" AS ENUM('draft', 'generated', 'downloaded', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."bituach_leumi_class" AS ENUM('employee_regular', 'employee_under_18', 'employee_over_retirement', 'controlling_shareholder', 'kibbutz_member', 'foreign_worker', 'student', 'other');--> statement-breakpoint
CREATE TYPE "public"."national_id_kind" AS ENUM('teudat_zehut', 'foreign_worker_id');--> statement-breakpoint
CREATE TYPE "public"."owner_compensation_kind" AS ENUM('salary', 'draw', 'dividend', 'loan_to_shareholder', 'shareholder_loan_repayment');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_kind" AS ENUM('round_number', 'weekend_cash', 'vendor_new_high_value', 'split_below_threshold', 'unusual_vat_rate', 'large_cash_payment');--> statement-breakpoint
CREATE TYPE "public"."risk_flag_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "client_wht_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"certificate_number" text,
	"rate_pct" numeric(5, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"scanned_blob_url" text,
	"scanned_key_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_wht_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"supplier_name_ciphertext" text,
	"supplier_vat_id_ciphertext" text,
	"dek_id" uuid,
	"rate_pct" numeric(5, 2) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"notes_ciphertext" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"declared_revenue_minor" bigint NOT NULL,
	"rate_pct" numeric(5, 2) NOT NULL,
	"amount_due_minor" bigint NOT NULL,
	"paid_at" timestamp,
	"asmachta" text,
	"paid_amount_minor" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "tax_filing_kind" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"status" "tax_filing_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"submitted_asmachta" text,
	"file_blob_url" text,
	"file_key_id" uuid,
	"file_mime" text,
	"totals_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_101_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"declaration_data_ciphertext" text,
	"dek_id" uuid,
	"submitted_at" timestamp,
	"submitted_asmachta" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"legal_name_ciphertext" text,
	"national_id_ciphertext" text,
	"national_id_kind" "national_id_kind" NOT NULL,
	"gross_monthly_minor_ciphertext" text,
	"credit_points_count" numeric(3, 1),
	"start_date" date NOT NULL,
	"end_date" date,
	"bituach_leumi_class" bituach_leumi_class NOT NULL,
	"tax_certificate_metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dek_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"period_label" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"totals_ciphertext" text,
	"breakdown_ciphertext" text,
	"form_102_prep_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dek_id" uuid,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pension_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"employee_contribution_minor" bigint NOT NULL,
	"employer_contribution_minor" bigint NOT NULL,
	"provider_name" text,
	"provider_account_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "severance_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"accrued_minor" bigint NOT NULL,
	"paid_at" timestamp,
	"paid_amount_minor" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"manifest_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_blob_url" text,
	"file_key_id" uuid,
	"total_artifacts" integer DEFAULT 0 NOT NULL,
	"generated_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"count_date" date NOT NULL,
	"items_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_value_minor" bigint NOT NULL,
	"counted_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "owner_compensation_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"tax_treatment_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "risk_flag_kind" NOT NULL,
	"severity" "risk_flag_severity" DEFAULT 'info' NOT NULL,
	"evidence_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" uuid,
	"linked_invoice_id" uuid,
	"linked_transaction_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_wht_certificates" ADD CONSTRAINT "client_wht_certificates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_wht_certificates" ADD CONSTRAINT "client_wht_certificates_scanned_key_id_data_encryption_keys_id_fk" FOREIGN KEY ("scanned_key_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_wht_rates" ADD CONSTRAINT "supplier_wht_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_wht_rates" ADD CONSTRAINT "supplier_wht_rates_dek_id_data_encryption_keys_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_advances" ADD CONSTRAINT "tax_advances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_file_key_id_data_encryption_keys_id_fk" FOREIGN KEY ("file_key_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_101_declarations" ADD CONSTRAINT "form_101_declarations_payroll_employee_id_payroll_employees_id_fk" FOREIGN KEY ("payroll_employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_101_declarations" ADD CONSTRAINT "form_101_declarations_dek_id_data_encryption_keys_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_dek_id_data_encryption_keys_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_dek_id_data_encryption_keys_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_contributions" ADD CONSTRAINT "pension_contributions_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pension_contributions" ADD CONSTRAINT "pension_contributions_payroll_employee_id_payroll_employees_id_fk" FOREIGN KEY ("payroll_employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "severance_provisions" ADD CONSTRAINT "severance_provisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "severance_provisions" ADD CONSTRAINT "severance_provisions_payroll_employee_id_payroll_employees_id_fk" FOREIGN KEY ("payroll_employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_packages" ADD CONSTRAINT "audit_packages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_packages" ADD CONSTRAINT "audit_packages_file_key_id_data_encryption_keys_id_fk" FOREIGN KEY ("file_key_id") REFERENCES "public"."data_encryption_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_packages" ADD CONSTRAINT "audit_packages_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_counted_by_user_id_users_id_fk" FOREIGN KEY ("counted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_compensation" ADD CONSTRAINT "owner_compensation_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_compensation" ADD CONSTRAINT "owner_compensation_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_wht_certificates_client_idx" ON "client_wht_certificates" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_wht_certificates_valid_idx" ON "client_wht_certificates" USING btree ("client_id","valid_from");--> statement-breakpoint
CREATE INDEX "supplier_wht_rates_business_idx" ON "supplier_wht_rates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "tax_advances_business_period_idx" ON "tax_advances" USING btree ("business_id","period_start");--> statement-breakpoint
CREATE INDEX "tax_filings_business_kind_period_idx" ON "tax_filings" USING btree ("business_id","kind","period_end");--> statement-breakpoint
CREATE INDEX "tax_filings_status_idx" ON "tax_filings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "form_101_declarations_employee_year_idx" ON "form_101_declarations" USING btree ("payroll_employee_id","fiscal_year");--> statement-breakpoint
CREATE INDEX "payroll_employees_business_idx" ON "payroll_employees" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_business_period_idx" ON "payroll_runs" USING btree ("business_id","period_end");--> statement-breakpoint
CREATE INDEX "pension_contributions_run_idx" ON "pension_contributions" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "pension_contributions_employee_idx" ON "pension_contributions" USING btree ("payroll_employee_id");--> statement-breakpoint
CREATE INDEX "severance_provisions_business_idx" ON "severance_provisions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "severance_provisions_employee_idx" ON "severance_provisions" USING btree ("payroll_employee_id");--> statement-breakpoint
CREATE INDEX "audit_packages_business_period_idx" ON "audit_packages" USING btree ("business_id","period_end");--> statement-breakpoint
CREATE INDEX "inventory_counts_business_date_idx" ON "inventory_counts" USING btree ("business_id","count_date");--> statement-breakpoint
CREATE INDEX "owner_compensation_business_period_idx" ON "owner_compensation" USING btree ("business_id","period_start");--> statement-breakpoint
CREATE INDEX "owner_compensation_owner_idx" ON "owner_compensation" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "risk_flags_business_idx" ON "risk_flags" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "risk_flags_business_unresolved_idx" ON "risk_flags" USING btree ("business_id","created_at") WHERE resolved_at IS NULL;