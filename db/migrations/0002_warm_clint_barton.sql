CREATE TYPE "public"."bookkeeping_method" AS ENUM('single_entry', 'double_entry');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('patur', 'morshe', 'hevra_baam', 'amuta', 'shutfut');--> statement-breakpoint
CREATE TYPE "public"."vat_status" AS ENUM('liable', 'osek_patur', 'osek_morshe', 'exporter', 'nonprofit');--> statement-breakpoint
CREATE TYPE "public"."engagement_role" AS ENUM('owner', 'accountant', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."subscription_provider" AS ENUM('mock', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."auth_event_type" AS ENUM('sign_in', 'sign_in_failed', 'sign_out', 'password_change', 'password_reset_request', 'password_reset_success', 'mfa_enroll', 'mfa_disable', 'mfa_challenge_success', 'mfa_challenge_failed', 'passkey_register', 'passkey_remove', 'recovery_code_used', 'suspicious_ip', 'step_up_grant', 'step_up_deny', 'engagement_invited', 'engagement_accepted', 'engagement_revoked', 'vat_status_transition', 'account_deleted');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"locale" text DEFAULT 'he-IL' NOT NULL,
	"country" text DEFAULT 'IL' NOT NULL,
	"dob_ciphertext" text,
	"national_id_ciphertext" text,
	"consent_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "business_vat_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"vat_status" "vat_status" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"reason" text,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"vat_id" text NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"vat_status" "vat_status" NOT NULL,
	"bookkeeping_method" "bookkeeping_method" NOT NULL,
	"tax_year_end_month" integer DEFAULT 12 NOT NULL,
	"advance_tax_rate_pct" numeric(5, 2),
	"tik_nikuyim" text,
	"default_currency" text DEFAULT 'ILS' NOT NULL,
	"next_invoice_sequence_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address_street" text,
	"address_city" text,
	"address_postal_code" text,
	"address_country" text DEFAULT 'IL' NOT NULL,
	"logo_blob_url" text,
	"signature_blob_url" text,
	"il_municipal_authority" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "accountant_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"accountant_user_id" uuid NOT NULL,
	"role" "engagement_role" DEFAULT 'accountant' NOT NULL,
	"scopes_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_id" text NOT NULL,
	"key" text NOT NULL,
	"value_int" integer,
	"value_bool" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlements_plan_id_key_pk" PRIMARY KEY("plan_id","key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ILS' NOT NULL,
	"billing_interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"provider" "subscription_provider" DEFAULT 'mock' NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"auth_user_id" text,
	"event_type" "auth_event_type" NOT NULL,
	"ip_hash" "bytea",
	"ua_hash" "bytea",
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_encryption_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"wrapped_dek" "bytea",
	"wrapped_dek_iv" "bytea",
	"wrapped_dek_auth_tag" "bytea",
	"kek_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"retired_at" timestamp,
	"destruction_notes" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_vat_status_history" ADD CONSTRAINT "business_vat_status_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_vat_status_history" ADD CONSTRAINT "business_vat_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountant_engagements" ADD CONSTRAINT "accountant_engagements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountant_engagements" ADD CONSTRAINT "accountant_engagements_accountant_user_id_users_id_fk" FOREIGN KEY ("accountant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_idx" ON "users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "business_vat_status_history_business_idx" ON "business_vat_status_history" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "business_vat_status_history_effective_idx" ON "business_vat_status_history" USING btree ("business_id","effective_from");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "businesses_vat_id_idx" ON "businesses" USING btree ("vat_id");--> statement-breakpoint
CREATE INDEX "accountant_engagements_business_idx" ON "accountant_engagements" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "accountant_engagements_user_idx" ON "accountant_engagements" USING btree ("accountant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accountant_engagements_unique_active_idx" ON "accountant_engagements" USING btree ("business_id","accountant_user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_sub_idx" ON "subscriptions" USING btree ("provider_subscription_id") WHERE provider_subscription_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_events_user_created_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_type_created_idx" ON "auth_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_ip_hash_idx" ON "auth_events" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_encryption_keys_purpose_active_idx" ON "data_encryption_keys" USING btree ("purpose") WHERE retired_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE read_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_lookup_idx" ON "rate_limit_buckets" USING btree ("kind","key","window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" USING btree ("expires_at");