import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Server-side onboarding gate. Reads two booleans via a single RLS-scoped
// transaction so the (app) layout can decide whether to redirect a fresh
// user into the wizard.
//
// `hasBusiness`     — at least one row in `businesses` is owned by this
//                     user (and not soft-deleted).
// `hasTransaction`  — at least one row in `transactions` is reachable
//                     under the user's businesses.
//
// `nextStep` is consumed by the dashboard's empty-state banner; the
// (app) layout itself only branches on `hasBusiness`.
export type OnboardingState = {
  hasBusiness: boolean;
  hasTransaction: boolean;
  nextStep: "profile" | "first_tx" | "done";
};

export async function getOnboardingState(
  userId: string,
): Promise<OnboardingState> {
  return withUser(userId, async (tx) => {
    const businessRows = (await tx.execute(
      sql`SELECT 1 FROM businesses WHERE deleted_at IS NULL LIMIT 1`,
    )) as unknown as Array<{ "?column?"?: number }>;
    const hasBusiness = businessRows.length > 0;

    let hasTransaction = false;
    if (hasBusiness) {
      const txnRows = (await tx.execute(
        sql`SELECT 1 FROM transactions LIMIT 1`,
      )) as unknown as Array<{ "?column?"?: number }>;
      hasTransaction = txnRows.length > 0;
    }

    const nextStep: OnboardingState["nextStep"] = !hasBusiness
      ? "profile"
      : !hasTransaction
        ? "first_tx"
        : "done";

    return { hasBusiness, hasTransaction, nextStep };
  });
}
