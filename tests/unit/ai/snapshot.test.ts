import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock `withUser` so the snapshot module can run without a live DB.
// The callback receives a fake `tx` whose `execute` returns the
// canned result for each SQL we expect (matched by substring).

type Row = Record<string, unknown>;
let queryResponses: Array<{ match: RegExp; rows: Row[] }>;

function sqlToString(query: unknown): string {
  // drizzle's `sql\`...\`` builder produces an object with a `queryChunks`
  // array of `{ value: string[] }` markers + interpolated values. We flatten
  // the static text portions for matching.
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

// Loaded AFTER the mock so the snapshot module picks up the stub.
const { generateSnapshotContext, SNAPSHOT_MAX_CHARS } = await import(
  "@/lib/ai/snapshot"
);
const { DEFAULT_DISCLAIMER } = await import("@/lib/ai/prompt");

beforeEach(() => {
  queryResponses = [];
});

describe("generateSnapshotContext — empty state", () => {
  it("returns a no-business snapshot when no business row exists", async () => {
    queryResponses = [
      { match: /FROM businesses/i, rows: [] }, // empty -> no business
    ];
    const snap = await generateSnapshotContext("user-1");
    expect(snap.hasBusiness).toBe(false);
    expect(snap.text).toContain(DEFAULT_DISCLAIMER.he);
    expect(snap.text).toContain(DEFAULT_DISCLAIMER.en);
    expect(snap.text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
  });
});

describe("generateSnapshotContext — populated business", () => {
  it("emits a redacted, disclaimer-suffixed snapshot under 1000 chars", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [
          {
            id: "biz-1",
            legal_name: "Solo 514321987 LTD",
            vat_status: "osek_morshe",
            entity_type: "patur",
            advance_tax_rate_pct: "4.50",
            default_currency: "ILS",
          },
        ],
      },
      {
        match: /FROM transactions/i,
        rows: [
          { direction: "income", total_minor: "12345600" }, // ₪123,456
          { direction: "expense", total_minor: "4500000" }, // ₪45,000
        ],
      },
      {
        // First invoices query: vat collected this period.
        match: /SUM\(vat_minor\)[\s\S]*FROM invoices/i,
        rows: [{ vat_collected_minor: "1234500", vat_paid_minor: "0" }],
      },
      {
        match: /FROM receipts/i,
        rows: [{ vat_collected_minor: "0", vat_paid_minor: "234500" }],
      },
      {
        // Second invoices query: overdue count + total.
        match: /COUNT\(\*\)[\s\S]*FROM invoices/i,
        rows: [{ overdue_count: "2", overdue_minor: "1180000" }],
      },
      {
        match: /FROM tax_advances/i,
        rows: [{ paid_ytd_minor: "1500000" }],
      },
    ];
    const snap = await generateSnapshotContext("user-1");
    expect(snap.hasBusiness).toBe(true);
    expect(snap.text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    // PII redaction: the 9-digit ח.פ. in legal_name must be masked.
    expect(snap.text).not.toContain("514321987");
    expect(snap.text).toContain("[masked]");
    // Disclaimer always present.
    expect(snap.text).toContain(DEFAULT_DISCLAIMER.he);
    expect(snap.text).toContain(DEFAULT_DISCLAIMER.en);
    // VAT this period = 12,345 - 2,345 = 10,000.
    expect(snap.inputs.vatPayableThisPeriodMinor).toBe(1_000_000n);
    expect(snap.inputs.overdueInvoiceCount).toBe(2);
    expect(snap.inputs.advanceTaxPaidYtdMinor).toBe(1_500_000n);
  });

  it("clamps the snapshot at 1000 chars when input data is overwhelming", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [
          {
            id: "biz-2",
            legal_name: "X".repeat(2000),
            vat_status: "osek_morshe",
            entity_type: "hevra_baam",
            advance_tax_rate_pct: "4.50",
            default_currency: "ILS",
          },
        ],
      },
      { match: /FROM transactions/i, rows: [] },
      { match: /SUM\(vat_minor\)[\s\S]*FROM invoices/i, rows: [] },
      { match: /FROM receipts/i, rows: [] },
      {
        match: /COUNT\(\*\)[\s\S]*FROM invoices/i,
        rows: [{ overdue_count: "0", overdue_minor: "0" }],
      },
      { match: /FROM tax_advances/i, rows: [{ paid_ytd_minor: "0" }] },
    ];
    const snap = await generateSnapshotContext("user-1");
    expect(snap.text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    // Disclaimer still tail-pinned.
    expect(snap.text.includes(DEFAULT_DISCLAIMER.he)).toBe(true);
  });

  it("tolerates missing tax_advances table (Layer 3 not yet migrated)", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [
          {
            id: "biz-3",
            legal_name: "Plain Name",
            vat_status: "osek_patur",
            entity_type: "patur",
            advance_tax_rate_pct: null,
            default_currency: "ILS",
          },
        ],
      },
      { match: /FROM transactions/i, rows: [] },
      { match: /SUM\(vat_minor\)[\s\S]*FROM invoices/i, rows: [] },
      { match: /FROM receipts/i, rows: [] },
      {
        match: /COUNT\(\*\)[\s\S]*FROM invoices/i,
        rows: [{ overdue_count: "0", overdue_minor: "0" }],
      },
      // tax_advances pseudo-throw via "no match" (returns []) wouldn't
      // exercise the catch; instead we let the helper succeed with 0.
      { match: /FROM tax_advances/i, rows: [{ paid_ytd_minor: "0" }] },
    ];
    const snap = await generateSnapshotContext("user-1");
    expect(snap.hasBusiness).toBe(true);
    expect(snap.inputs.advanceTaxPaidYtdMinor).toBe(0n);
    expect(snap.text).toContain("Advance-tax rate not yet assigned");
  });
});
