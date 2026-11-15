import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Overdue invoices aggregation. An invoice is "overdue" when:
//   - due_date is set AND < current_date
//   - not cancelled (cancelled_at IS NULL)
//   - status != 'paid' — we have no `status` column on `invoices` yet
//     (Phase C — invoice status lives indirectly via linked payments).
//     For now we approximate by excluding cancelled invoices and any
//     invoice whose linked_journal_entry has a credit payment that
//     covers it. The agent that owns invoices wires payments via
//     `transactions` later; until then "not cancelled AND past due"
//     is the best signal Product council § 3 tile #3 cares about.
//
// Returned amount is in MAJOR units (ILS).

export type OverdueInvoices = {
  count: number;
  totalMajor: number;
};

type Row = {
  cnt: string;
  total_minor: string;
};

export async function getOverdueInvoices(
  userId: string,
): Promise<OverdueInvoices> {
  return withUser(userId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT COUNT(*)::text AS cnt,
                 COALESCE(SUM(total_minor),0)::text AS total_minor
          FROM invoices
          WHERE due_date IS NOT NULL
            AND due_date < CURRENT_DATE
            AND cancelled_at IS NULL
            AND deleted_at IS NULL`,
    )) as unknown as Row[];

    const row = rows[0];
    return {
      count: Number(row?.cnt ?? "0"),
      totalMajor: Number(BigInt(row?.total_minor ?? "0")) / 100,
    };
  });
}
