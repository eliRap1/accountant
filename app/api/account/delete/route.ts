import { sql } from "drizzle-orm";
import { headers as nextHeaders } from "next/headers";
import { auth } from "@/lib/auth/better";
import { currentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";

// Account self-deletion endpoint (Plan v4 Risk #7 / IL Privacy Law
// Amendment 13 right-of-erasure).
//
// Soft-delete flow (foreground; runs inside one service-role transaction):
//  1. `users.deleted_at = now()` — app row is marked. PII columns
//     (dob_ciphertext, national_id_ciphertext) remain in place; they
//     will become unreadable once the nightly DEK-purge cron retires
//     the wrapped DEK rows for this user's PII purposes (see
//     /api/cron/account-purge).
//  2. Better Auth `user.banned = true` + `ban_reason = 'self-deletion'`
//     to block any future sign-in attempt.
//  3. Hard-delete every session row so existing browsers/devices lose
//     their cookie's server-side counterpart immediately.
//  4. Soft-revoke any active accountant_engagements where THIS user is
//     the accountant — co-owned businesses lose this user's access at
//     once, but the engagement row stays for the auditor's view.
//  5. Append an `auth_events` row of type `account_deleted` for the
//     7-year audit trail.
//
// Hard-delete + DEK destruction is deferred to the 30-day grace window
// purge cron — gives a user-recoverable undo window AND lets us purge
// PII in a controlled idempotent sweep instead of on the request path.
//
// Step-up auth: spec accepts a `password` field in the body (matches
// CURRENT account.password via Better Auth's signInEmail endpoint).
// Future iteration will swap to the step-up registry once
// lib/auth/stepUp.ts lands (P0 #2 in handoff.md).
export const dynamic = "force-dynamic";

type DeleteBody = {
  password?: string;
};

export async function POST(request: Request): Promise<Response> {
  const u = await currentUser();
  if (!u) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Body MUST contain `password`. We re-verify it through Better Auth's
  // sign-in endpoint — that's the safest way to confirm the password
  // without touching the `account` table's scrypt hash ourselves.
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.password || typeof body.password !== "string") {
    return Response.json(
      { error: "password_required" },
      { status: 400 },
    );
  }

  // Verify the password by attempting a sign-in. Better Auth throws
  // (or returns an error response) on bad credentials; we wrap in
  // try/catch + treat any failure as 401. The returned token/session
  // is discarded — we're about to nuke the user anyway.
  try {
    await auth.api.signInEmail({
      body: {
        email: u.email,
        password: body.password,
        rememberMe: false,
      },
      headers: await nextHeaders(),
    });
  } catch {
    return Response.json(
      { error: "password_incorrect" },
      { status: 401 },
    );
  }

  // Council C-2: account deletion is a step-up-protected op. The
  // payload hash binds the grant to THIS user — a step-up for user A
  // cannot release deletion of user B (the userId is part of the
  // hash). The password re-check above is a second factor for
  // ownership; the step-up grant proves the action was authorised in
  // the last 5 min from a UI surface that knows the op symbol.
  try {
    await requireFreshSession({
      op: "account.delete",
      payloadHash: computePayloadHash({ userId: u.appUserId }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return Response.json(
        {
          error: "step_up_required",
          op: err.op,
          payloadHash: err.payloadHash,
        },
        { status: 401 },
      );
    }
    throw err;
  }

  // Soft-delete + ban + session purge + engagement revoke + audit
  // happen in a single service-role transaction so a partial failure
  // doesn't leave the user in a half-deleted state.
  const metadata = JSON.stringify({
    phase: "soft_delete",
    source: "self_service",
  });

  await withServiceRole(async (tx) => {
    await tx.execute(
      sql`UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = ${u.appUserId}::uuid`,
    );
    await tx.execute(
      sql`UPDATE "user"
          SET banned = true,
              ban_reason = 'self-deletion',
              updated_at = now()
        WHERE id = ${u.authUserId}`,
    );
    await tx.execute(
      sql`DELETE FROM session WHERE user_id = ${u.authUserId}`,
    );
    await tx.execute(
      sql`UPDATE accountant_engagements
          SET revoked_at = now(), updated_at = now()
        WHERE accountant_user_id = ${u.appUserId}::uuid
          AND revoked_at IS NULL`,
    );
    await tx.execute(
      sql`INSERT INTO auth_events (user_id, auth_user_id, event_type, metadata_jsonb)
          VALUES (
            ${u.appUserId}::uuid,
            ${u.authUserId},
            'account_deleted'::auth_event_type,
            ${metadata}::jsonb
          )`,
    );
  });

  return Response.json({ ok: true });
}
