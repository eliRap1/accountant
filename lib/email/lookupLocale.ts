import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * Look up an app user's preferred locale by Better Auth user id. Defaults
 * to `he-IL` for any miss (row absent, transient DB error, unknown locale
 * string). NEVER throws — used inside auth send hooks where a thrown
 * exception would crash signup.
 *
 * Uses `withServiceRole` because the Better Auth hook fires before
 * `app.current_user_id` is set, so RLS would block a regular read of the
 * `users` table.
 */
export async function lookupLocaleForUser(
  authUserId: string,
): Promise<AppLocale> {
  try {
    const rows = (await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT locale FROM users WHERE auth_user_id = ${authUserId} LIMIT 1`,
      );
    })) as unknown as Array<{ locale: string }>;

    const row = rows[0];
    if (!row) return "he-IL";

    const candidate = row.locale;
    if (
      (routing.locales as readonly string[]).includes(candidate)
    ) {
      return candidate as AppLocale;
    }
    return "he-IL";
  } catch {
    // Service-role read failed (Neon cold-start? migration in flight?).
    // Default to he-IL — IL-first audience, and we'd rather send a HE
    // verification email to a future en-US user than not send at all.
    return "he-IL";
  }
}

/**
 * Same lookup keyed by app email. Used by the emailOTP hook because that
 * plugin's `sendVerificationOTP` only receives an email string, not the
 * Better Auth user row.
 */
export async function lookupLocaleForEmail(email: string): Promise<AppLocale> {
  try {
    const rows = (await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT u.locale
            FROM users u
            JOIN "user" b ON b.id = u.auth_user_id
            WHERE b.email = ${email}
            LIMIT 1`,
      );
    })) as unknown as Array<{ locale: string }>;

    const row = rows[0];
    if (!row) return "he-IL";

    const candidate = row.locale;
    if (
      (routing.locales as readonly string[]).includes(candidate)
    ) {
      return candidate as AppLocale;
    }
    return "he-IL";
  } catch {
    return "he-IL";
  }
}
