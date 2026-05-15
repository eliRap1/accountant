import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

let appUserClient: postgres.Sql | null = null;
let appServiceClient: postgres.Sql | null = null;

function getAppUserClient(): postgres.Sql {
  if (!appUserClient) {
    appUserClient = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      prepare: false, // Neon pooler doesn't support prepared statements
    });
  }
  return appUserClient;
}

function getAppServiceClient(): postgres.Sql {
  if (!appServiceClient) {
    appServiceClient = postgres(env().DATABASE_URL_UNPOOLED, {
      max: 5,
      idle_timeout: 20,
    });
  }
  return appServiceClient;
}

/**
 * `db` is the default app-facing handle. Pool is shared across requests.
 * Most application code MUST go through `withUser(userId, tx => ...)` to
 * enforce RLS — never query this handle directly outside auth-resolution helpers.
 */
export const db: PostgresJsDatabase<typeof schema> = drizzle(getAppUserClient(), { schema });

/**
 * `dbService` uses the unpooled URL with the `app_service` role for migrations,
 * cron jobs, and admin-only reads (auth_events, rate_limit_buckets). Wrap
 * actual usage in `withServiceRole(...)` so the SET LOCAL ROLE is applied.
 */
export const dbService: PostgresJsDatabase<typeof schema> = drizzle(getAppServiceClient(), { schema });

export type DB = typeof db;
