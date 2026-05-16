import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Spending-by-category: groups expense transactions by chart-of-accounts
// code over a rolling window. Mirrors the ChatGPT Personal Finance
// "where your money went" view, but scoped to the user's active business
// via RLS. Returns major units for direct display.

export type SpendingByCategoryRow = {
  categoryCode: string | null;
  categoryName: string | null;
  totalMajor: number;
};

export type SpendingByCategory = {
  windowDays: number;
  rows: SpendingByCategoryRow[];
  totalMajor: number;
};

type DbRow = {
  category_code: string | null;
  category_name: string | null;
  total_minor: string;
};

const MAX_CATEGORIES = 12;

export async function getSpendingByCategory(
  userId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<SpendingByCategory> {
  const windowDays = opts.windowDays ?? 30;
  const now = opts.now ?? new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - windowDays);
  const startIso = startDate.toISOString().slice(0, 10);
  const endIso = now.toISOString().slice(0, 10);

  return withUser(userId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT t.category_code,
                 COALESCE(coa.name_he, coa.name_en) AS category_name,
                 COALESCE(SUM(t.amount_minor), 0)::text AS total_minor
          FROM transactions t
          LEFT JOIN chart_of_accounts coa
            ON coa.code = t.category_code
           AND (coa.business_id = t.business_id OR coa.business_id IS NULL)
          WHERE t.direction = 'expense'
            AND t.txn_date >= ${startIso}::date
            AND t.txn_date <= ${endIso}::date
          GROUP BY t.category_code, coa.name_he, coa.name_en
          ORDER BY SUM(t.amount_minor) DESC
          LIMIT ${MAX_CATEGORIES}`,
    )) as unknown as DbRow[];

    const mapped = rows.map((r) => ({
      categoryCode: r.category_code,
      categoryName: r.category_name,
      totalMajor: Number(BigInt(r.total_minor)) / 100,
    }));

    const totalMajor = mapped.reduce((acc, r) => acc + r.totalMajor, 0);

    return { windowDays, rows: mapped, totalMajor };
  });
}
