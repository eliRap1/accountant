import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

let appUserClient: postgres.Sql | null = null;
let appServiceClient: postgres.Sql | null = null;

function getAppUserClient(): postgres.Sql {
  if (!appUserClient) {
    appUserClient = postgres(env().DATABASE_URL, {
      // Council DB Architect: Neon Free caps at ~100 connections; Fluid
      // Compute can warm-start dozens of instances. Keep per-instance pool
      // tiny and rely on Neon's pgbouncer for concurrency upstream.
      max: 2,
      idle_timeout: 10,
      max_lifetime: 60 * 30,
      // Neon pooler (transaction mode) does not support prepared statements.
      prepare: false,
      // Make undefined === SQL NULL so omitted columns don't crash on NOT NULL
      // checks during partial inserts (postgres-js default is to omit param,
      // which produces "bind message supplies N parameters, but prepared
      // statement requires M").
      transform: { undefined: null },
      connection: { application_name: "accountant-web" },
    });
  }
  return appUserClient;
}

function getAppServiceClient(): postgres.Sql {
  if (!appServiceClient) {
    appServiceClient = postgres(env().DATABASE_URL_UNPOOLED, {
      max: 1,
      idle_timeout: 10,
      // Direct (unpooled) endpoint *does* support prepared statements, but
      // Fluid Compute instances are ephemeral — caching prepared statements
      // across cold starts wastes server-side state. Disable.
      prepare: false,
      transform: { undefined: null },
      connection: { application_name: "accountant-service" },
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
