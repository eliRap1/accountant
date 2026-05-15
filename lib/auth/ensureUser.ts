/**
 * Mirror a Better Auth `user` row into our app `users` table.
 *
 * Better Auth manages its own identity tables (user/account/session/...).
 * Our app maintains a parallel `users` table keyed by `auth_user_id =
 * better_auth.user.id`. That gives us: locale, country, consent flags,
 * encrypted PII (dob, national_id), and the FK target for every RLS policy.
 *
 * STUB UNTIL Phase A.2c lands db/schema/users.ts. The Better Auth
 * `databaseHooks.user.create.after` calls this exactly once per signup, so
 * fixing the stub later costs zero migrations — only the row insert.
 */
export async function ensureAppUser(user: {
  id: string;
  email: string;
  emailVerified?: boolean;
  name?: string | null;
}): Promise<void> {
  // TODO(A.2c): insert into db/schema/users.ts using:
  //   withServiceRole((tx) => tx.insert(users).values({
  //     authUserId: user.id, email: user.email, locale: 'he-IL',
  //     country: 'IL', createdAt: new Date(), ...
  //   }).onConflictDoNothing());
  console.info("[ensureAppUser] stub — Phase A.2c", {
    id: user.id,
    email: user.email,
  });
}
