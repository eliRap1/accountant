import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";

// Nightly account-purge cron (Plan v4 Risk #7 / IL Privacy Law
// Amendment 13 right-of-erasure + Income Tax Ordinance § 130 7-year
// retention).
//
// Triggered by Vercel Cron via `vercel.ts` `crons[]`. Schedule:
// `0 3 * * *` (daily 03:00 UTC = 06:00 Jerusalem).
//
// What this does:
//  1. Find every user with `deleted_at < now() - 30 days`. The 30-day
//     grace window matches Plan v4 deletion policy — gives the user
//     time to recover via support.
//  2. For each user, retire (mark + zero) every DEK row whose
//     `purpose` matches that user. We use a `user:<appUserId>:*`
//     naming convention going forward; receipts/financial_statements
//     reference DEKs via `file_key_id`, which we also include.
//  3. Hard-delete `notifications` (no retention obligation; PII).
//  4. Hard-delete `processor_sync_credentials` for businesses the user
//     owns — encrypted API keys; useless after DEK destroyed but
//     better to remove the row outright.
//  5. Keep tax-related rows (`tax_filings`, `invoices`, `payroll_runs`,
//     `journal_entries`, `journal_lines`) — IL Income Tax Ordinance
//     § 130 mandates 7-year retention. The ciphertext columns inside
//     those rows become mathematically unrecoverable due to DEK
//     destruction in step 2.
//  6. Append a fresh `auth_events` row of type `account_deleted` per
//     user, with metadata `{phase: 'dek_purge', purged_dek_count}`.
//
// Idempotency: re-running on a user whose DEKs are already retired is
// safe — the UPDATE filter `WHERE retired_at IS NULL` simply matches
// zero rows. Hard-deletes of notifications + processor_sync_credentials
// are also idempotent (DELETE matches nothing on re-run).
//
// Auth: requires `Authorization: Bearer ${process.env.CRON_SECRET}`.
// Vercel Cron auto-injects this header (see Vercel docs §
// "Securing cron jobs"). In development (`NODE_ENV !== 'production'`)
// the header is optional so a developer can curl the endpoint to
// verify the logic.
export const dynamic = "force-dynamic";

const PURGE_GRACE_INTERVAL = "30 days";

type DueUser = {
  app_user_id: string;
  auth_user_id: string | null;
};

type DekRow = {
  id: string;
};

export async function GET(request: Request): Promise<Response> {
  // CRON_SECRET gate.
  const cronSecret = process.env["CRON_SECRET"];
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";

  if (cronSecret) {
    if (provided !== cronSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    // Dev-mode bypass: only when explicitly NOT production. We refuse
    // to run unauthenticated against a production environment even if
    // someone forgot to set CRON_SECRET — fail-safe over fail-open.
    if (process.env["NODE_ENV"] === "production") {
      return Response.json(
        { error: "cron_secret_missing" },
        { status: 503 },
      );
    }
  }

  let totalUsers = 0;
  let totalDeksRetired = 0;
  let totalNotificationsDeleted = 0;
  let totalProcessorRowsDeleted = 0;

  await withServiceRole(async (tx) => {
    // 1) Find users past the 30-day grace window.
    const due = (await tx.execute(
      sql`SELECT u.id AS app_user_id, u.auth_user_id
            FROM users u
           WHERE u.deleted_at IS NOT NULL
             AND u.deleted_at < now() - (${PURGE_GRACE_INTERVAL}::interval)`,
    )) as unknown as Array<DueUser>;

    totalUsers = due.length;

    for (const row of due) {
      const appUserId = row.app_user_id;
      const authUserId = row.auth_user_id;
      const purgedAt = new Date().toISOString();
      const note = `auto-purge cron, user_id=${appUserId}, purged_at=${purgedAt}`;

      // 2) DEK destruction. Two sources:
      //    (a) purpose names matching `user:<appUserId>:*` — the
      //        forward-going convention for user-scoped DEKs.
      //    (b) file_key_id rows on receipts / financial_statements for
      //        businesses this user owns — these are tied to user-
      //        owned data through the business hierarchy.
      const purposePattern = `user:${appUserId}:%`;
      const retired = (await tx.execute(
        sql`UPDATE data_encryption_keys
              SET retired_at = now(),
                  wrapped_dek = NULL,
                  wrapped_dek_iv = NULL,
                  wrapped_dek_auth_tag = NULL,
                  destruction_notes = ${note}
            WHERE retired_at IS NULL
              AND (
                purpose LIKE ${purposePattern}
                OR id IN (
                  SELECT file_key_id FROM receipts
                    WHERE file_key_id IS NOT NULL
                      AND business_id IN (
                        SELECT id FROM businesses WHERE owner_user_id = ${appUserId}::uuid
                      )
                  UNION
                  SELECT file_key_id FROM financial_statements
                    WHERE file_key_id IS NOT NULL
                      AND business_id IN (
                        SELECT id FROM businesses WHERE owner_user_id = ${appUserId}::uuid
                      )
                )
              )
            RETURNING id`,
      )) as unknown as Array<DekRow>;
      totalDeksRetired += retired.length;

      // 3) Notifications — no retention obligation, drop them.
      const notifResult = (await tx.execute(
        sql`DELETE FROM notifications WHERE user_id = ${appUserId}::uuid RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      totalNotificationsDeleted += notifResult.length;

      // 4) Processor sync credentials — encrypted API keys for
      //    businesses owned by this user. Hard-delete since the
      //    underlying DEK is now retired and the row is dead weight.
      const procResult = (await tx.execute(
        sql`DELETE FROM processor_sync_credentials
              WHERE business_id IN (
                SELECT id FROM businesses WHERE owner_user_id = ${appUserId}::uuid
              )
              RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      totalProcessorRowsDeleted += procResult.length;

      // 6) Audit event for the purge phase.
      const metadata = JSON.stringify({
        phase: "dek_purge",
        purged_dek_count: retired.length,
        notifications_deleted: notifResult.length,
        processor_credentials_deleted: procResult.length,
      });
      await tx.execute(
        sql`INSERT INTO auth_events (user_id, auth_user_id, event_type, metadata_jsonb)
            VALUES (
              ${appUserId}::uuid,
              ${authUserId},
              'account_deleted'::auth_event_type,
              ${metadata}::jsonb
            )`,
      );
    }
  });

  const summary = {
    purged: totalUsers,
    deksRetired: totalDeksRetired,
    notificationsDeleted: totalNotificationsDeleted,
    processorCredentialsDeleted: totalProcessorRowsDeleted,
    runAt: new Date().toISOString(),
  };

  console.log("[cron.account-purge] complete", summary);

  return Response.json(summary, { status: 200 });
}
