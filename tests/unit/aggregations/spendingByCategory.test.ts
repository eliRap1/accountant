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

const { getSpendingByCategory } = await import(
  "@/lib/aggregations/spendingByCategory"
);

describe("getSpendingByCategory", () => {
  beforeEach(() => {
    queryResponses = [];
  });

  it("maps DB rows to major-unit category totals and echoes windowDays", async () => {
    queryResponses = [
      {
        match: /FROM transactions/i,
        rows: [
          { category_code: "5210", category_name: "Software", total_minor: "120000" },
          { category_code: "5310", category_name: "Travel", total_minor: "75000" },
          { category_code: null, category_name: null, total_minor: "30000" },
        ],
      },
    ];

    const result = await getSpendingByCategory("user-1", { windowDays: 30 });

    expect(result.rows).toEqual([
      { categoryCode: "5210", categoryName: "Software", totalMajor: 1200 },
      { categoryCode: "5310", categoryName: "Travel", totalMajor: 750 },
      { categoryCode: null, categoryName: null, totalMajor: 300 },
    ]);
    expect(result.totalMajor).toBe(2250);
    expect(result.windowDays).toBe(30);
  });

  it("returns empty rows + zero total when no transactions match", async () => {
    queryResponses = [{ match: /FROM transactions/i, rows: [] }];
    const result = await getSpendingByCategory("user-1", { windowDays: 90 });
    expect(result.rows).toEqual([]);
    expect(result.totalMajor).toBe(0);
    expect(result.windowDays).toBe(90);
  });
});
