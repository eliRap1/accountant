import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { dbService } from "@/db/client";

// מקדמות paid vs due — Product council § 3 tile #5. Layer 3 schema
// dependency: `tax_advances` table. We fail-soft when the table isn't
// migrated locally yet, returning `available: false` so the UI can render
// a "not available yet" copy instead of crashing.
//
// Returned amounts in MAJOR units (ILS).

export type AdvanceTaxStatus =
  | {
      available: false;
    }
  | {
      available: true;
      dueMajor: number;
      paidMajor: number;
      /** Net (due − paid). Negative means overpaid. */
      balanceMajor: number;
      installmentCount: number;
    };

type SumRow = {
  total_due_minor: string;
  total_paid_minor: string;
  installment_count: string;
};

export async function getAdvanceTaxStatus(
  userId: string,
): Promise<AdvanceTaxStatus> {
  try {
    // Probe outside the per-user transaction. `to_regclass` returns
    // NULL when the table is missing — fast metadata-only check, no
    // RLS path, no `app.current_user_id` requirement.
    const probeRows = (await dbService.execute(
      sql`SELECT to_regclass('public.tax_advances') IS NOT NULL AS exists`,
    )) as unknown as Array<{ exists: boolean }>;
    if (!probeRows[0]?.exists) return { available: false };

    return await withUser(userId, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT COALESCE(SUM(amount_due_minor),0)::text  AS total_due_minor,
                   COALESCE(SUM(paid_amount_minor),0)::text AS total_paid_minor,
                   COUNT(*)::text                            AS installment_count
            FROM tax_advances`,
      )) as unknown as SumRow[];

      const row = rows[0];
      const due = BigInt(row?.total_due_minor ?? "0");
      const paid = BigInt(row?.total_paid_minor ?? "0");
      const balance = due - paid;

      return {
        available: true,
        dueMajor: Number(due) / 100,
        paidMajor: Number(paid) / 100,
        balanceMajor: Number(balance) / 100,
        installmentCount: Number(row?.installment_count ?? "0"),
      };
    });
  } catch {
    // Either table missing or RLS gap mid-migration — return the
    // fail-soft shape so the UI never crashes on the dashboard.
    return { available: false };
  }
}
