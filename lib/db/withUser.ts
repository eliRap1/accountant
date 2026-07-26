import { sql } from "drizzle-orm";
import { db } from "@/db/client";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a transaction that has been scoped to the calling user.
 *
 * 1. `SET LOCAL ROLE app_user` switches off the BYPASSRLS default role,
 *    so Postgres enforces row-level security.
 * 2. `set_config('app.current_user_id', userId, true)` populates the
 *    custom GUC that every user-scoped table's RLS policy reads.
 *
 * Both changes are LOCAL to the transaction, so they unwind cleanly when
 * the transaction commits or rolls back.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}
