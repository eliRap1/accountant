import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// 6-month profit trend — income − expense per month, oldest first.
// Drives the line chart on the new dashboard (Product council § 3
// tile #6: "the only 'performance' KPI an עצמאי emotionally connects
// with"). Major units (ILS).

export type MonthlyProfitPoint = {
  /** 0..11 zero-indexed month (JS Date.getMonth() convention). */
  monthIdx: number;
  /** 'YYYY-MM' key, useful for ordering and tooltips. */
  monthKey: string;
  /** Income − expense in major units (₪). */
  profit: number;
};

export type MonthlyProfitTrend = {
  rows: MonthlyProfitPoint[];
  /** True when every row in the window is exactly 0 (no data). */
  isEmpty: boolean;
};

type Bucket = {
  month_bucket: string;
  direction: "income" | "expense" | "transfer";
  total_minor: string;
};

const WINDOW_MONTHS = 6;

function buildEmptyRows(now: Date): MonthlyProfitPoint[] {
  const rows: MonthlyProfitPoint[] = [];
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const idx = d.getMonth();
    const monthKey = `${d.getFullYear()}-${String(idx + 1).padStart(2, "0")}`;
    rows.push({ monthIdx: idx, monthKey, profit: 0 });
  }
  return rows;
}

export async function getMonthlyProfitTrend(
  userId: string,
): Promise<MonthlyProfitTrend> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (WINDOW_MONTHS - 1), 1);
  const startIso = start.toISOString().slice(0, 10);

  return withUser(userId, async (tx) => {
    const buckets = (await tx.execute(
      sql`SELECT
            to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month_bucket,
            direction,
            SUM(amount_minor)::text AS total_minor
          FROM transactions
          WHERE txn_date >= ${startIso}::date
          GROUP BY 1, 2`,
    )) as unknown as Bucket[];

    const rows = buildEmptyRows(now);
    // Track gross sums so we can collapse income−expense → profit per bucket.
    const incomeByKey = new Map<string, bigint>();
    const expenseByKey = new Map<string, bigint>();
    for (const b of buckets) {
      const v = BigInt(b.total_minor);
      if (b.direction === "income") {
        incomeByKey.set(b.month_bucket, (incomeByKey.get(b.month_bucket) ?? 0n) + v);
      } else if (b.direction === "expense") {
        expenseByKey.set(b.month_bucket, (expenseByKey.get(b.month_bucket) ?? 0n) + v);
      }
    }

    for (const row of rows) {
      const inc = incomeByKey.get(row.monthKey) ?? 0n;
      const exp = expenseByKey.get(row.monthKey) ?? 0n;
      row.profit = Number(inc - exp) / 100;
    }

    const isEmpty = rows.every((r) => r.profit === 0);
    return { rows, isEmpty };
  });
}
