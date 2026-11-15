-- Phase D Layer 1 — AI tax-advisor conversation persistence.
--
-- Adds two tables previously referenced by the chat / history routes as
-- a graceful no-op:
--   * ai_conversations: per-user thread metadata + (optional) active
--     business context + room for a rolling encrypted summary.
--   * ai_messages: append-only message log with envelope-encrypted
--     content (purpose `ai:user:<userId>:messages`, AAD bound to the
--     row id — see db/schema/ai.ts for the convention).
--
-- The quota counter in app/api/ai/chat/route.ts already probes
-- `information_schema.tables` for `ai_messages`; once this migration
-- lands the probe stops short-circuiting and starts reading real rows.
--
-- RLS lives in the companion migration 0012_rls_ai.sql.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS ai_messages CASCADE;
--   DROP TABLE IF EXISTS ai_conversations CASCADE;
--   COMMIT;

CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"title" text,
	"summary_ciphertext" text,
	"summary_dek_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"content_dek_id" uuid NOT NULL,
	"tool_calls_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "ai_conversations_business_idx" ON "ai_conversations" USING btree ("business_id");
--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_created_idx" ON "ai_messages" USING btree ("conversation_id","created_at");
