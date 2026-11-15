import { cache } from "react";
import { headers as nextHeaders } from "next/headers";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth/better";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { ensureAppUser } from "@/lib/auth/ensureUser";

export type CurrentUser = {
  authUserId: string;
  appUserId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  sessionId: string;
  sessionExpiresAt: Date;
};

// Resolve the active Better Auth session and map it to our app `users.id`.
// React's `cache()` deduplicates within a single Server Component render
// pass, so chained server-only callers (layout → page → component) can
// each invoke currentUser() without triggering a fresh DB lookup.
//
// Returns null when:
//   - no session cookie present
//   - session expired
//   - cookie present but Better Auth session row missing
//
// If the app `users` row is missing despite a valid Better Auth session
// (rare — could happen if the create.after hook lost a transient error),
// we backfill it inline. The unique index on users.auth_user_id keeps the
// backfill safe under concurrent renders.
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const hs = await nextHeaders();
  const result = await auth.api.getSession({ headers: hs });
  if (!result) return null;
  const { session, user } = result;

  const lookup = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id FROM users WHERE auth_user_id = ${user.id} LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0];
  });

  let appUserId = lookup?.id;
  if (!appUserId) {
    const ensured = await ensureAppUser({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified ?? false,
      name: user.name ?? null,
    });
    appUserId = ensured.appUserId;
  }

  return {
    authUserId: user.id,
    appUserId,
    email: user.email,
    emailVerified: user.emailVerified ?? false,
    name: user.name ?? null,
    sessionId: session.id,
    sessionExpiresAt:
      session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt),
  };
});

// Throws (redirect-friendly) when no session — use from route handlers
// guarded by middleware so the redirect never actually fires.
export async function requireCurrentUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) {
    throw new Error("requireCurrentUser: no active session");
  }
  return u;
}
