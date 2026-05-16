import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let queryResponses: Array<{ match: RegExp; rows: Row[] }> = [];

function sqlToString(query: unknown): string {
  if (typeof query === "string") return query;
  if (query && typeof query === "object" && "queryChunks" in query) {
    const chunks = (query as { queryChunks: unknown[] }).queryChunks;
    return chunks
      .map((c) => {
        if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          return Array.isArray(v) ? v.join("") : String(v);
        }
        return "";
      })
      .join(" ");
  }
  return String(query);
}

const mockTx = {
  execute: async (query: unknown) => {
    const sqlString = sqlToString(query);
    for (const { match, rows } of queryResponses) {
      if (match.test(sqlString)) return rows;
    }
    return [];
  },
};

vi.mock("@/lib/db/withUser", () => ({
  withUser: async <T,>(
    _userId: string,
    fn: (tx: typeof mockTx) => Promise<T>,
  ): Promise<T> => fn(mockTx),
}));

const { getRecurringSubscriptions } = await import(
  "@/lib/aggregations/recurringSubscriptions"
);

describe("getRecurringSubscriptions", () => {
  beforeEach(() => {
    queryResponses = [];
  });

  it("detects monthly Netflix and weekly grocery, ignores single-occurrence vendor", async () => {
    queryResponses = [
      {
        match: /FROM transactions/i,
        rows: [
          { vendor: "netflix", txn_date: "2026-04-01", amount_minor: "5990" },
          { vendor: "netflix", txn_date: "2026-03-01", amount_minor: "5990" },
          { vendor: "netflix", txn_date: "2026-02-01", amount_minor: "5990" },
          { vendor: "shufersal", txn_date: "2026-05-10", amount_minor: "23000" },
          { vendor: "shufersal", txn_date: "2026-05-03", amount_minor: "21000" },
          { vendor: "shufersal", txn_date: "2026-04-26", amount_minor: "22000" },
          { vendor: "shufersal", txn_date: "2026-04-19", amount_minor: "22500" },
          { vendor: "oneoff-vendor", txn_date: "2026-05-01", amount_minor: "10000" },
        ],
      },
    ];

    const result = await getRecurringSubscriptions("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });

    expect(result.subscriptions.map((s) => s.vendor)).toContain("netflix");
    expect(result.subscriptions.map((s) => s.vendor)).toContain("shufersal");
    expect(result.subscriptions.map((s) => s.vendor)).not.toContain(
      "oneoff-vendor",
    );

    const netflix = result.subscriptions.find((s) => s.vendor === "netflix")!;
    expect(netflix.cadence).toBe("monthly");
    expect(netflix.monthlyCostMajor).toBeCloseTo(59.9, 1);

    const shufersal = result.subscriptions.find((s) => s.vendor === "shufersal")!;
    expect(shufersal.cadence).toBe("weekly");
  });

  it("returns empty list when no vendor has >=3 transactions", async () => {
    queryResponses = [
      {
        match: /FROM transactions/i,
        rows: [
          { vendor: "a", txn_date: "2026-05-01", amount_minor: "1000" },
          { vendor: "a", txn_date: "2026-04-01", amount_minor: "1000" },
        ],
      },
    ];
    const result = await getRecurringSubscriptions("user-1");
    expect(result.subscriptions).toEqual([]);
  });
});
