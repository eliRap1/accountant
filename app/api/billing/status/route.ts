// GET /api/billing/status
//
// Lightweight endpoint the billing success page polls until the webhook
// for the just-finished Checkout Session lands. Returns the current
// active subscription (if any) for the signed-in user, plus a hint that
// the front-end uses to decide whether to keep polling.

import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubRow = {
  plan_id: string;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  provider: string;
};

export async function GET(): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = (await withServiceRole(async (tx) => {
    return (await tx.execute(
      sql`SELECT plan_id, status, current_period_end, cancel_at_period_end, provider
            FROM subscriptions
           WHERE user_id = ${user.appUserId}::uuid
           ORDER BY created_at DESC
           LIMIT 1`,
    )) as unknown as SubRow[];
  })) as SubRow[];

  const top = rows[0];
  if (!top) {
    return Response.json({
      planId: "free",
      status: "none",
      provider: "mock",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  }

  return Response.json({
    planId: top.plan_id,
    status: top.status,
    provider: top.provider,
    currentPeriodEnd:
      top.current_period_end instanceof Date
        ? top.current_period_end.toISOString()
        : top.current_period_end,
    cancelAtPeriodEnd: top.cancel_at_period_end,
  });
}
