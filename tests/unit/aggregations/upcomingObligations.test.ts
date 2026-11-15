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

const { getUpcomingObligations } = await import(
  "@/lib/aggregations/upcomingObligations"
);

describe("getUpcomingObligations", () => {
  beforeEach(() => {
    queryResponses = [];
  });

  it("merges VAT, Bituach, makdamot, filings, invoices and sorts ascending", async () => {
    queryResponses = [
      {
        match: /FROM tax_advances/i,
        rows: [
          { id: "ta-1", period_end: "2026-06-15", amount_due_minor: "120000" },
        ],
      },
      {
        match: /FROM tax_filings/i,
        rows: [
          { id: "f-1", kind: "pcn874", period_end: "2026-04-30", status: "generated" },
        ],
      },
      {
        match: /FROM invoices/i,
        rows: [
          {
            id: "inv-1",
            sequential_number: 100,
            due_date: "2026-05-25",
            total_minor: "50000",
            currency_at_issue: "ILS",
          },
        ],
      },
    ];

    const result = await getUpcomingObligations("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });

    expect(result.items.length).toBeGreaterThan(0);
    const kinds = result.items.map((i) => i.kind);
    expect(kinds).toContain("vat_period_close");
    expect(kinds).toContain("bituach_leumi");
    expect(kinds).toContain("makdamot");
    expect(kinds).toContain("filing");
    expect(kinds).toContain("invoice");

    const isoDates = result.items.map((i) => i.dueDateIso);
    const sorted = [...isoDates].sort();
    expect(isoDates).toEqual(sorted);
  });

  it("falls back gracefully when tax_advances and tax_filings tables are missing or empty", async () => {
    queryResponses = [];
    const result = await getUpcomingObligations("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });
    expect(result.items.some((i) => i.kind === "vat_period_close")).toBe(true);
    expect(result.items.some((i) => i.kind === "bituach_leumi")).toBe(true);
  });

  it("synthesises due date for pcn874 as 15th of month after period_end", async () => {
    queryResponses = [
      {
        match: /FROM tax_filings/i,
        rows: [
          { id: "f-pcn", kind: "pcn874", period_end: "2026-04-30", status: "generated" },
        ],
      },
    ];
    const result = await getUpcomingObligations("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });
    const filing = result.items.find((i) => i.kind === "filing")!;
    expect(filing).toBeDefined();
    expect(filing.dueDateIso).toBe("2026-05-15");
  });
});
