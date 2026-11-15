import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Cash-on-hand aggregation. Sums opening balances of every (active)
// financial account this user can see, then adjusts by realised
// income/expense transactions. Transfers cancel out because they are
// between accounts inside the same business — they don't change cash.
//
// Why we don't query journal_lines: a single-entry business may not
// have a fully balanced ledger at all (Product council § 4 — Ledger is
// the bookkeeper view, transactions is the עצמאי view). Driving the
// number off `transactions` keeps the tile correct for both bookkeeping
// methods without requiring journal posting.
//
// Returned in MAJOR units (ILS) for direct display.

export type CashOnHand = {
  totalMajor: number;
  openingBalanceMajor: number;
  netFlowMajor: number;
  /** Number of financial accounts contributing to the sum. */
  accountCount: number;
};

type OpeningRow = {
  total_minor: string;
  account_count: string;
};

type FlowRow = {
  direction: "income" | "expense" | "transfer";
  total_minor: string;
};

export async function getCashOnHand(userId: string): Promise<CashOnHand> {
  return withUser(userId, async (tx) => {
    // Opening balances across not-closed financial accounts.
    const openingRows = (await tx.execute(
      sql`SELECT COALESCE(SUM(opening_balance_minor),0)::text AS total_minor,
                 COUNT(*)::text AS account_count
          FROM financial_accounts
          WHERE closed_at IS NULL`,
    )) as unknown as OpeningRow[];

    const opening = BigInt(openingRows[0]?.total_minor ?? "0");
    const accountCount = Number(openingRows[0]?.account_count ?? "0");

    // Realised income/expense from transactions (transfers are within-
    // business and net to zero across accounts).
    const flowRows = (await tx.execute(
      sql`SELECT direction, COALESCE(SUM(amount_minor),0)::text AS total_minor
          FROM transactions
          GROUP BY direction`,
    )) as unknown as FlowRow[];

    let incomeMinor = 0n;
    let expensesMinor = 0n;
    for (const r of flowRows) {
      const v = BigInt(r.total_minor);
      if (r.direction === "income") incomeMinor = v;
      else if (r.direction === "expense") expensesMinor = v;
    }

    const netFlow = incomeMinor - expensesMinor;
    const total = opening + netFlow;

    return {
      totalMajor: Number(total) / 100,
      openingBalanceMajor: Number(opening) / 100,
      netFlowMajor: Number(netFlow) / 100,
      accountCount,
    };
  });
}
