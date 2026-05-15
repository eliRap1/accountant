ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "two_factor" ALTER COLUMN "verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "two_factor" ALTER COLUMN "verified" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "two_factor_enabled" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "banned" SET NOT NULL;--> statement-breakpoint
-- RLS roles. NOLOGIN: only assumed via SET LOCAL ROLE from a privileged
-- session (neondb_owner). Must exist before lib/db/withUser is ever called.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    CREATE ROLE app_service NOLOGIN BYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT app_user, app_service TO neondb_owner;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user, app_service;--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_service;--> statement-breakpoint
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_service;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_service;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_service;
