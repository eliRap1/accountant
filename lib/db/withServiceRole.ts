import { sql } from "drizzle-orm";
import { dbService } from "@/db/client";

type Tx = Parameters<Parameters<typeof dbService.transaction>[0]>[0];

/**
 * Run `fn` as `app_service`. Used for migrations, cron jobs, and reads
 * of admin-only tables (auth_events, rate_limit_buckets). RLS is bypassed.
 *
 * Callers MUST self-audit that they are not exposing per-user data
 * across users. Prefer `withUser` for any path triggered by an HTTP
 * request from an authenticated user.
 */
export async function withServiceRole<T>(
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return dbService.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_service`);
    return fn(tx);
  });
}
