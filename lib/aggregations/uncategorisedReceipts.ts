import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Uncategorised receipts aggregation. A receipt is "uncategorised" if
// its status is 'pending_review' OR its category_code is NULL — either
// way it's not yet contributing to VAT recoverable totals.
//
// Product council § 3 tile #4 wants a "do this next" nudge. Count is
// the headline; sum is shown as a secondary metric.
//
// Returned amount is in MAJOR units (ILS).

export type UncategorisedReceipts = {
  count: number;
  totalMajor: number;
};

type Row = {
  cnt: string;
  total_minor: string;
};

export async function getUncategorisedReceipts(
  userId: string,
): Promise<UncategorisedReceipts> {
  return withUser(userId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT COUNT(*)::text AS cnt,
                 COALESCE(SUM(parsed_amount_minor),0)::text AS total_minor
          FROM receipts
          WHERE status = 'pending_review'
             OR category_code IS NULL`,
    )) as unknown as Row[];

    const row = rows[0];
    return {
      count: Number(row?.cnt ?? "0"),
      totalMajor: Number(BigInt(row?.total_minor ?? "0")) / 100,
    };
  });
}
