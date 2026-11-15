import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { getCashOnHand } from "@/lib/aggregations/cashOnHand";

// Cash runway: how many months until cash hits zero at the current
// net-burn rate. Net burn = avg monthly expenses - avg monthly income
// over the last 6 months (clipped to >= 0). When the business is
// cash-flow positive on average, runway is conceptually infinite — we
// surface this as `monthsRemaining = null` so the card can render a
// dedicated "positive cashflow" treatment.

export type CashRunway = {
  cashOnHandMajor: number;
  avgMonthlyExpensesMajor: number;
  avgMonthlyIncomeMajor: number;
  avgMonthlyNetBurnMajor: number;
  /** null when net burn <= 0 (positive cashflow / unknown). */
  monthsRemaining: number | null;
  windowMonths: number;
};

type FlowRow = {
  month_bucket: string;
  direction: string;
  total_minor: string;
};

export async function getCashRunway(
  userId: string,
  opts: { now?: Date; windowMonths?: number } = {},
): Promise<CashRunway> {
  const windowMonths = opts.windowMonths ?? 6;
  const now = opts.now ?? new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (windowMonths - 1), 1),
  );
  const startIso = start.toISOString().slice(0, 10);

  const cash = await getCashOnHand(userId);

  const rows = await withUser(userId, async (tx) => {
    return (await tx.execute(
      sql`SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month_bucket,
                 direction::text,
                 COALESCE(SUM(amount_minor), 0)::text AS total_minor
          FROM transactions
          WHERE txn_date >= ${startIso}::date
            AND direction IN ('income', 'expense')
          GROUP BY 1, 2`,
    )) as unknown as FlowRow[];
  });

  let totalIncomeMinor = 0n;
  let totalExpensesMinor = 0n;
  const distinctMonths = new Set<string>();
  for (const r of rows) {
    const v = BigInt(r.total_minor);
    if (r.direction === "income") totalIncomeMinor += v;
    else if (r.direction === "expense") totalExpensesMinor += v;
    distinctMonths.add(r.month_bucket);
  }

  // Divide by the actual number of months with data, capped at windowMonths.
  // Using the observed count avoids inflating the average when early months
  // have no transactions (e.g. a recently-opened business).
  const divisor = Math.min(distinctMonths.size, windowMonths) || windowMonths;

  const avgMonthlyIncomeMajor =
    Number(totalIncomeMinor) / 100 / divisor;
  const avgMonthlyExpensesMajor =
    Number(totalExpensesMinor) / 100 / divisor;
  const avgMonthlyNetBurnMajor = Math.max(
    0,
    avgMonthlyExpensesMajor - avgMonthlyIncomeMajor,
  );

  let monthsRemaining: number | null;
  if (cash.totalMajor <= 0) {
    monthsRemaining = 0;
  } else if (avgMonthlyNetBurnMajor <= 0) {
    monthsRemaining = null;
  } else {
    monthsRemaining = cash.totalMajor / avgMonthlyNetBurnMajor;
  }

  return {
    cashOnHandMajor: cash.totalMajor,
    avgMonthlyExpensesMajor,
    avgMonthlyIncomeMajor,
    avgMonthlyNetBurnMajor,
    monthsRemaining,
    windowMonths,
  };
}
