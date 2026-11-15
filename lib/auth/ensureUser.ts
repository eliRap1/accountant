import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { users } from "@/db/schema/identity";

// Mirror a Better Auth `user` row into our app `users` table.
//
// Better Auth manages its own identity tables (user/account/session/...).
// Our app maintains a parallel `users` table keyed by `auth_user_id =
// better_auth.user.id`. That gives us: locale, country, consent flags,
// encrypted PII (dob, national_id), and the FK target for every RLS policy.
//
// Called from lib/auth/better.ts databaseHooks.user.create.after, which
// fires exactly once per signup. Idempotent via the (auth_user_id) unique
// index — a retry from a transient post-signup error will not duplicate.
//
// Uses withServiceRole because:
//   1. The Better Auth `user.create.after` callback runs without a usable
//      `app.current_user_id` GUC — we don't have an app users.id yet to set.
//   2. The INSERT must succeed before the session settles, so RLS would
//      block it.
export async function ensureAppUser(authUser: {
  id: string;
  email: string;
  emailVerified?: boolean;
  name?: string | null;
}): Promise<{ appUserId: string }> {
  return withServiceRole(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({ authUserId: authUser.id })
      .onConflictDoNothing({ target: users.authUserId })
      .returning({ id: users.id });

    if (inserted.length > 0 && inserted[0]) {
      return { appUserId: inserted[0].id };
    }

    // Conflict path: row already existed. Fetch its id.
    const existing = (await tx.execute(
      sql`SELECT id FROM users WHERE auth_user_id = ${authUser.id} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    const row = existing[0];
    if (!row) {
      throw new Error(
        `ensureAppUser: row missing after conflict for auth_user_id=${authUser.id}`,
      );
    }
    return { appUserId: row.id };
  });
}
