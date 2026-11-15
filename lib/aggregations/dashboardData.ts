import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// 12-month revenue + expense + ebitda series, plus rolled-up KPI values.
// Every figure here is an ESTIMATE — surfaced under the "Estimates only"
// disclaimer banner. Numbers are in major units (ILS) for chart display;
// underlying ledger lives in minor units (agorot).
//
// Methodology (Phase B.2 chunk A — first cut):
//  - revenue = SUM(transactions.amount_minor) WHERE direction = 'income'
//    grouped by month bucket of txn_date.
//  - expenses = SUM(amount_minor) WHERE direction = 'expense'.
//  - ebitda (proxy) = revenue − expenses for the same month.
//
// We deliberately query `transactions` rather than `invoices` so the
// dashboard reflects realised cash flow and matches what the user has
// recorded — not what they've billed. Phase C will switch the "accrual
// view" toggle to derive revenue from invoices.subtotal_minor instead.
//
// When no rows exist we synthesise 12 zero rows so the chart renders
// the empty grid instead of a blank gap. The month labels are 'Jan'..
// 'Dec' (English); the client view localises via the `app.dashboard.
// months` array. Aligning by month-index (0-11) keeps that mapping clean.

export type DashboardRow = {
  monthIdx: number;
  monthKey: string; // 'YYYY-MM' for tooltips / debugging
  revenue: number; // major units (ILS)
  expenses: number;
  ebitda: number;
};

export type DashboardKpis = {
  arrEstimate: number; // last month × 12
  grossMarginPct: number; // (revenue - expenses) / revenue × 100
  ebitdaSum: number; // sum over the 12 months
  yoyPct: number; // last month vs first month
};

export type DashboardData = {
  rows: DashboardRow[];
  kpis: DashboardKpis;
  isEmpty: boolean;
};

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function emptyRows(now: Date): DashboardRow[] {
  // Build 12 buckets ending in the current month (oldest first).
  const rows: DashboardRow[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const idx = d.getMonth();
    const monthKey = `${d.getFullYear()}-${String(idx + 1).padStart(2, "0")}`;
    rows.push({
      monthIdx: idx,
      monthKey,
      revenue: 0,
      expenses: 0,
      ebitda: 0,
    });
  }
  return rows;
}

function computeKpis(rows: DashboardRow[]): DashboardKpis {
  if (rows.length === 0) {
    return { arrEstimate: 0, grossMarginPct: 0, ebitdaSum: 0, yoyPct: 0 };
  }
  const totalRevenue = rows.reduce((acc, r) => acc + r.revenue, 0);
  const totalExpenses = rows.reduce((acc, r) => acc + r.expenses, 0);
  const ebitdaSum = rows.reduce((acc, r) => acc + r.ebitda, 0);
  const last = rows[rows.length - 1] ?? rows[0];
  const first = rows[0];
  const arrEstimate = (last?.revenue ?? 0) * 12;
  const grossMarginPct =
    totalRevenue > 0
      ? ((totalRevenue - totalExpenses) / totalRevenue) * 100
      : 0;
  const yoyPct =
    first && first.revenue > 0 && last
      ? ((last.revenue - first.revenue) / first.revenue) * 100
      : 0;
  return {
    arrEstimate,
    grossMarginPct,
    ebitdaSum,
    yoyPct,
  };
}

export async function getDashboardData(
  userId: string,
): Promise<DashboardData> {
  const now = new Date();
  // Boundary = 12 months ago, snapped to the 1st of that month.
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const startIso = start.toISOString().slice(0, 10);

  return withUser(userId, async (tx) => {
    type Bucket = {
      month_bucket: string;
      direction: "income" | "expense" | "transfer";
      total_minor: string;
    };

    const buckets = (await tx.execute(
      sql`
        SELECT
          to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month_bucket,
          direction,
          SUM(amount_minor)::text AS total_minor
        FROM transactions
        WHERE txn_date >= ${startIso}::date
        GROUP BY 1, 2
      `,
    )) as unknown as Bucket[];

    const rows = emptyRows(now);

    for (const b of buckets) {
      const row = rows.find((r) => r.monthKey === b.month_bucket);
      if (!row) continue;
      const major = Number(BigInt(b.total_minor)) / 100;
      if (b.direction === "income") row.revenue = major;
      else if (b.direction === "expense") row.expenses = major;
    }

    for (const r of rows) {
      r.ebitda = r.revenue - r.expenses;
    }

    const kpis = computeKpis(rows);
    const isEmpty = rows.every((r) => r.revenue === 0 && r.expenses === 0);

    return { rows, kpis, isEmpty };
  });
}

// Helper for client side — maps a 0..11 monthIdx to its short label using
// the locale's translation array. Exposed here so the data shape can stay
// locale-agnostic on the server.
export function labelForMonthIdx(
  idx: number,
  months: string[] | undefined,
): string {
  if (months && months[idx]) return months[idx]!;
  return SHORT_MONTHS[idx] ?? "";
}
