import { describe, it, expect, beforeEach, vi } from "vitest";
import { __testing } from "@/lib/ai/morningBrief";

// Mock layers
//
// - `withUser` is stubbed so the aggregator's SQL never actually hits a
//   DB. Pattern mirrors tests/unit/ai/snapshot.test.ts.
// - `runFullTaxEngine` is also stubbed so we can drive vatDueMinor cleanly.
// - `renderMorningBriefSentence` is left REAL so we exercise the wiring
//   end-to-end (no DB, pure templating).

type Row = Record<string, unknown>;
let queryResponses: Array<{ match: RegExp; rows: Row[] }>;

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

// runFullTaxEngine is stubbed because tests don't drive YTD income/expenses
// — the brief only needs `vatPayableThisPeriodMinor`. We pre-populate
// other fields with zeros / defaults that the type contract requires.
const mockEstimate = {
  vatPayableThisPeriodMinor: 0n,
  // The rest is irrelevant to the brief; just satisfy types where touched.
  disclaimer: { he: "", en: "" },
  year: 2026,
  rulesVersion: "test",
  rulesHumanReviewed: false,
  incomeMinor: 0n,
  expensesMinor: 0n,
  incomeTax: null,
  bituachLeumi: null,
  advanceTaxMonthlyInstallmentMinor: null,
  activeAllocationThresholdMinor: 0n,
  advanceTaxRateRange: { minPct: 0, maxPct: 0 },
};
let engineVatDue: bigint;

vi.mock("@/lib/tax/il/runEngineForUser", () => ({
  runFullTaxEngine: async () => ({
    ...mockEstimate,
    vatPayableThisPeriodMinor: engineVatDue,
  }),
  // Re-exports that snapshot.ts pulls — kept identity-shaped for tests.
  rulesForYear: () => ({}),
  activeAllocationThresholdMinor: () => 0n,
}));

// Loaded AFTER the mock.
const { composeMorningBrief } = await import("@/lib/ai/morningBrief");

beforeEach(() => {
  queryResponses = [];
  engineVatDue = 0n;
});

// ─────────────────────────────────────────────────────────────────────────
// pickAction priority — unit isolation
// ─────────────────────────────────────────────────────────────────────────

describe("pickAction — priority ladder", () => {
  it("1. pay_vat when VAT due ≤7d AND cash short", () => {
    expect(
      __testing.pickAction({
        vatDueMinor: 342_000n,
        cashOnHandMinor: 200_000n,
        daysUntilDue: 5,
        overdueInvoiceCount: 2,
        pendingReceiptCount: 3,
      }),
    ).toBe("pay_vat");
  });

  it("2. follow_up_overdue when no urgent VAT AND overdue invoices exist", () => {
    expect(
      __testing.pickAction({
        vatDueMinor: 342_000n,
        cashOnHandMinor: 500_000n,
        daysUntilDue: 30,
        overdueInvoiceCount: 2,
        pendingReceiptCount: 3,
      }),
    ).toBe("follow_up_overdue");
  });

  it("3. categorise_receipts when no urgent VAT AND no overdue invoices", () => {
    expect(
      __testing.pickAction({
        vatDueMinor: 0n,
        cashOnHandMinor: 500_000n,
        daysUntilDue: 30,
        overdueInvoiceCount: 0,
        pendingReceiptCount: 3,
      }),
    ).toBe("categorise_receipts");
  });

  it("4. pay_vat fallback when VAT due ≤7d but cash covers it (no other blockers)", () => {
    expect(
      __testing.pickAction({
        vatDueMinor: 100_000n,
        cashOnHandMinor: 500_000n,
        daysUntilDue: 5,
        overdueInvoiceCount: 0,
        pendingReceiptCount: 0,
      }),
    ).toBe("pay_vat");
  });

  it("5. nothing_urgent when all green", () => {
    expect(
      __testing.pickAction({
        vatDueMinor: 0n,
        cashOnHandMinor: 500_000n,
        daysUntilDue: 30,
        overdueInvoiceCount: 0,
        pendingReceiptCount: 0,
      }),
    ).toBe("nothing_urgent");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// composeMorningBrief — end-to-end
// ─────────────────────────────────────────────────────────────────────────

describe("composeMorningBrief — empty business", () => {
  it("returns nothing_urgent when no business exists", async () => {
    queryResponses = [{ match: /FROM businesses/i, rows: [] }];
    engineVatDue = 0n;

    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      now: new Date(Date.UTC(2026, 6, 10)),
    });

    expect(out.actionNext).toBe("nothing_urgent");
    expect(out.vatDueMinor).toBe(0n);
    expect(out.metadata.hasBusiness).toBe(false);
    // Sentences always rendered for both languages.
    expect(out.he).toContain("בוקר טוב");
    expect(out.en).toContain("Good morning");
  });
});

describe("composeMorningBrief — populated business with VAT due", () => {
  it("picks pay_vat when cash short of imminent VAT bill", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [{ id: "biz-1", vat_status: "osek_morshe" }],
      },
      // Cash query — uses `WITH opening AS ...` pattern.
      {
        match: /opening|cash_minor/i,
        rows: [{ cash_minor: "218000" }], // ₪2,180
      },
      // Overdue invoices — no overdue in this scenario.
      {
        match: /SELECT COUNT\(\*\)::text AS overdue_count/i,
        rows: [{ overdue_count: "0", overdue_total_minor: "0" }],
      },
      // Pending receipts — none.
      {
        match: /SELECT COUNT\(\*\)::text AS pending_count/i,
        rows: [{ pending_count: "0" }],
      },
    ];
    engineVatDue = 342_000n; // ₪3,420

    // Pick a `now` whose VAT window deadline is within 7 days.
    // Window deadlines: Mar-15, May-15, Jul-15, Sep-15, Nov-15.
    // Use 2026-07-12 → deadline 2026-07-15 (3 days out).
    const now = new Date(Date.UTC(2026, 6, 12));

    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      userName: "יוסי",
      now,
    });

    expect(out.actionNext).toBe("pay_vat");
    expect(out.vatDueMinor).toBe(342_000n);
    expect(out.cashOnHandMinor).toBe(218_000n);
    expect(out.cashGapMinor).toBe(124_000n);
    expect(out.he).toContain("חסר ₪1,240");
    expect(out.metadata.hasBusiness).toBe(true);
    expect(out.metadata.sentDay).toBe("2026-07-12");
  });

  it("picks follow_up_overdue when overdue invoices exist and VAT not urgent", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [{ id: "biz-1", vat_status: "osek_morshe" }],
      },
      { match: /opening|cash_minor/i, rows: [{ cash_minor: "500000" }] },
      {
        match: /SELECT COUNT\(\*\)::text AS overdue_count/i,
        rows: [{ overdue_count: "3", overdue_total_minor: "1500000" }],
      },
      {
        match: /SELECT COUNT\(\*\)::text AS pending_count/i,
        rows: [{ pending_count: "0" }],
      },
    ];
    engineVatDue = 50_000n; // small VAT, not urgent

    // 2026-04-01 — VAT deadline is May-15 (44 days out → not urgent).
    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      now: new Date(Date.UTC(2026, 3, 1)),
    });

    expect(out.actionNext).toBe("follow_up_overdue");
    expect(out.metadata.overdueInvoiceCount).toBe(3);
    expect(out.metadata.overdueInvoiceTotalMinor).toBe(1_500_000n);
    expect(out.he).toContain("3 חשבוניות פתוחות");
    expect(out.he).toContain("₪15,000");
  });

  it("picks categorise_receipts when only pending receipts remain", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [{ id: "biz-1", vat_status: "osek_morshe" }],
      },
      { match: /opening|cash_minor/i, rows: [{ cash_minor: "500000" }] },
      {
        match: /SELECT COUNT\(\*\)::text AS overdue_count/i,
        rows: [{ overdue_count: "0", overdue_total_minor: "0" }],
      },
      {
        match: /SELECT COUNT\(\*\)::text AS pending_count/i,
        rows: [{ pending_count: "1" }],
      },
      {
        match: /SELECT parsed_amount_minor/i,
        rows: [{ amount_minor: "38000", vendor: null }],
      },
    ];
    engineVatDue = 0n;

    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      now: new Date(Date.UTC(2026, 3, 1)),
    });

    expect(out.actionNext).toBe("categorise_receipts");
    expect(out.metadata.pendingReceiptCount).toBe(1);
    expect(out.metadata.oldestPendingReceipt?.amountMinor).toBe(38_000n);
    // Vendor is null (ciphertext) — sentence falls back gracefully.
    expect(out.he).toContain("ספק לא ידוע");
  });

  it("picks nothing_urgent when all green", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [{ id: "biz-1", vat_status: "osek_morshe" }],
      },
      { match: /opening|cash_minor/i, rows: [{ cash_minor: "1000000" }] },
      {
        match: /SELECT COUNT\(\*\)::text AS overdue_count/i,
        rows: [{ overdue_count: "0", overdue_total_minor: "0" }],
      },
      {
        match: /SELECT COUNT\(\*\)::text AS pending_count/i,
        rows: [{ pending_count: "0" }],
      },
    ];
    engineVatDue = 0n;

    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "en-US",
      userName: "Yossi",
      now: new Date(Date.UTC(2026, 3, 1)),
    });

    expect(out.actionNext).toBe("nothing_urgent");
    expect(out.en).toContain("Nothing urgent");
    expect(out.en).toContain("Good morning Yossi");
  });

  it("clamps cashGapMinor at 0n when cash >= VAT due (pay_vat covered branch)", async () => {
    queryResponses = [
      {
        match: /FROM businesses/i,
        rows: [{ id: "biz-1", vat_status: "osek_morshe" }],
      },
      { match: /opening|cash_minor/i, rows: [{ cash_minor: "1000000" }] },
      {
        match: /SELECT COUNT\(\*\)::text AS overdue_count/i,
        rows: [{ overdue_count: "0", overdue_total_minor: "0" }],
      },
      {
        match: /SELECT COUNT\(\*\)::text AS pending_count/i,
        rows: [{ pending_count: "0" }],
      },
    ];
    engineVatDue = 100_000n;

    // VAT due within 7d, cash covers it → fallback pay_vat
    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      now: new Date(Date.UTC(2026, 6, 12)),
    });

    expect(out.actionNext).toBe("pay_vat");
    expect(out.cashGapMinor).toBe(0n);
    expect(out.he).toContain("מכוסה");
  });
});

describe("composeMorningBrief — sentDay metadata", () => {
  it("stamps the UTC date so the cron's idempotency check works", async () => {
    queryResponses = [{ match: /FROM businesses/i, rows: [] }];
    const out = await composeMorningBrief({
      userId: "user-1",
      locale: "he-IL",
      now: new Date(Date.UTC(2026, 4, 16, 6, 0, 0)),
    });
    expect(out.metadata.sentDay).toBe("2026-05-16");
  });
});
