import { describe, it, expect } from "vitest";
import { manualInvoiceProvider } from "@/lib/invoices/providers/manual";
import type { DrizzleTx } from "@/lib/invoices/sequential";
import type { Business } from "@/lib/invoices/providers/IInvoiceProvider";

// Lightweight tx mock — same shape used in sequential.test.ts. We capture
// the values passed to INSERT statements so we can assert on the
// allocation_status and allocation_required_at_issue computed by the
// provider.

type MockState = {
  selectRows: Array<Record<string, unknown>>;
  executeCalls: string[];
  updateCalls: Array<{ values: Record<string, unknown> }>;
  insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
  returningIds: string[];
};

function sqlChunksToString(query: unknown): string {
  const q = query as { queryChunks?: Array<unknown> } | undefined;
  if (!q?.queryChunks || !Array.isArray(q.queryChunks)) return String(query);
  return q.queryChunks
    .map((c) => {
      if (c && typeof c === "object" && "value" in (c as Record<string, unknown>)) {
        const v = (c as { value: unknown }).value;
        if (Array.isArray(v)) return v.join("");
      }
      return "?";
    })
    .join("");
}

function makeMockTx(state: MockState): DrizzleTx {
  let returningCursor = 0;
  const tx = {
    execute: async (_query: unknown) => {
      const queryStr = sqlChunksToString(_query);
      state.executeCalls.push(queryStr);
      if (queryStr.includes("next_invoice_sequence_jsonb")) {
        return state.selectRows;
      }
      return [];
    },
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_pred: unknown) => {
          state.updateCalls.push({ values });
          return undefined;
        },
      }),
    }),
    insert: (table: { _: { name?: string } }) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const tableName = table?._?.name ?? "<unknown>";
        const valArr = Array.isArray(values) ? values : [values];
        for (const v of valArr) {
          state.insertCalls.push({ table: tableName, values: v });
        }
        const returning = () => {
          const id = state.returningIds[returningCursor++] ?? "fallback-id";
          return Promise.resolve([{ id }]);
        };
        // Some call sites do .insert().values().returning(); others do
        // just .insert().values(). Make values() awaitable and also
        // expose .returning().
        const valuesPromise = Promise.resolve([] as unknown[]) as unknown as Promise<unknown[]> & {
          returning: typeof returning;
        };
        (valuesPromise as Promise<unknown[]> & {
          returning: typeof returning;
        }).returning = returning;
        return valuesPromise;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };
  return tx as unknown as DrizzleTx;
}

// Synthetic business fixture. Only the fields the provider reads matter
// — `id`, `vatStatus`, `vatId`, `nextInvoiceSequenceJsonb`. The rest are
// padded with reasonable defaults.
function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    ownerUserId: "00000000-0000-0000-0000-0000000000aa",
    legalName: "Acme Test Ltd",
    vatId: "514321983",
    entityType: "morshe",
    vatStatus: "osek_morshe",
    bookkeepingMethod: "double_entry",
    taxYearEndMonth: 12,
    advanceTaxRatePct: null,
    tikNikuyim: null,
    defaultCurrency: "ILS",
    nextInvoiceSequenceJsonb: {},
    addressStreet: null,
    addressCity: null,
    addressPostalCode: null,
    addressCountry: "IL",
    logoBlobUrl: null,
    signatureBlobUrl: null,
    ilMunicipalAuthority: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as Business;
}

const ACTOR_USER_ID = "00000000-0000-0000-0000-0000000000aa";

describe("manualInvoiceProvider.issueInvoice — allocation status", () => {
  it("sets allocation_status='not_required' for under-threshold osek_morshe", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
      returningIds: ["00000000-0000-0000-0000-000000000aaa"],
    };
    const tx = makeMockTx(state);
    const business = makeBusiness({ vatStatus: "osek_morshe" });
    const result = await manualInvoiceProvider.issueInvoice({
      tx,
      business,
      actorUserId: ACTOR_USER_ID,
      invoiceType: "tax_invoice",
      issueDate: "2026-06-15",
      currency: "ILS",
      subtotalMinor: 423_729n, // ~ ₪4,237.29 net
      vatMinor: 76_271n,
      totalMinor: 500_000n, // exactly ₪5,000 — at threshold, NOT required
      vatRate: "18.00",
      lines: [],
    });
    expect(result.allocationStatus).toBe("not_required");

    // Filter to the actual invoice INSERT — distinguished from the
    // sequence-audit INSERT by the presence of allocation fields.
    const invoiceInsert = state.insertCalls.find(
      (c) =>
        c.values["invoiceType"] === "tax_invoice" &&
        "allocationStatus" in c.values,
    );
    expect(invoiceInsert).toBeDefined();
    expect(invoiceInsert!.values["allocationStatus"]).toBe("not_required");
    expect(invoiceInsert!.values["allocationRequiredAtIssue"]).toBe(false);
  });

  it("sets allocation_status='required_not_assigned' for over-threshold osek_morshe", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
      returningIds: ["00000000-0000-0000-0000-000000000bbb"],
    };
    const tx = makeMockTx(state);
    const business = makeBusiness({ vatStatus: "osek_morshe" });
    const result = await manualInvoiceProvider.issueInvoice({
      tx,
      business,
      actorUserId: ACTOR_USER_ID,
      invoiceType: "tax_invoice",
      issueDate: "2026-06-15",
      currency: "ILS",
      subtotalMinor: 500_100n,
      vatMinor: 90_018n,
      totalMinor: 590_118n, // > ₪5,000 -> required
      vatRate: "18.00",
      lines: [],
    });
    expect(result.allocationStatus).toBe("required_not_assigned");

    // Filter to the actual invoice INSERT — distinguished from the
    // sequence-audit INSERT by the presence of allocation fields.
    const invoiceInsert = state.insertCalls.find(
      (c) =>
        c.values["invoiceType"] === "tax_invoice" &&
        "allocationStatus" in c.values,
    );
    expect(invoiceInsert!.values["allocationStatus"]).toBe(
      "required_not_assigned",
    );
    expect(invoiceInsert!.values["allocationRequiredAtIssue"]).toBe(true);
  });

  it("never requires allocation for osek_patur regardless of amount", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
      returningIds: ["00000000-0000-0000-0000-000000000ccc"],
    };
    const tx = makeMockTx(state);
    const business = makeBusiness({ vatStatus: "osek_patur" });
    const result = await manualInvoiceProvider.issueInvoice({
      tx,
      business,
      actorUserId: ACTOR_USER_ID,
      invoiceType: "tax_invoice",
      issueDate: "2026-06-15",
      currency: "ILS",
      subtotalMinor: 100_000_000n,
      vatMinor: 0n,
      totalMinor: 100_000_000n,
      vatRate: "0.00",
      lines: [],
    });
    expect(result.allocationStatus).toBe("not_required");
  });

  it("threshold step at 2026-06-01: ₪9k pre-step not required, post-step required", async () => {
    // Pre-step (2026-05-31, threshold ₪10k) — ₪9k is under, not required.
    {
      const state: MockState = {
        selectRows: [{ jsonb: {} }],
        executeCalls: [],
        updateCalls: [],
        insertCalls: [],
        returningIds: ["00000000-0000-0000-0000-000000000111"],
      };
      const tx = makeMockTx(state);
      const business = makeBusiness({ vatStatus: "osek_morshe" });
      const r = await manualInvoiceProvider.issueInvoice({
        tx,
        business,
        actorUserId: ACTOR_USER_ID,
        invoiceType: "tax_invoice",
        issueDate: "2026-05-31",
        currency: "ILS",
        subtotalMinor: 762_711n,
        vatMinor: 137_289n,
        totalMinor: 900_000n,
        vatRate: "18.00",
        lines: [],
      });
      expect(r.allocationStatus).toBe("not_required");
    }
    // Post-step (2026-06-01, threshold ₪5k) — ₪9k is over, required.
    {
      const state: MockState = {
        selectRows: [{ jsonb: {} }],
        executeCalls: [],
        updateCalls: [],
        insertCalls: [],
        returningIds: ["00000000-0000-0000-0000-000000000222"],
      };
      const tx = makeMockTx(state);
      const business = makeBusiness({ vatStatus: "osek_morshe" });
      const r = await manualInvoiceProvider.issueInvoice({
        tx,
        business,
        actorUserId: ACTOR_USER_ID,
        invoiceType: "tax_invoice",
        issueDate: "2026-06-01",
        currency: "ILS",
        subtotalMinor: 762_711n,
        vatMinor: 137_289n,
        totalMinor: 900_000n,
        vatRate: "18.00",
        lines: [],
      });
      expect(r.allocationStatus).toBe("required_not_assigned");
    }
  });

  it("rejects mismatched subtotal + vat vs total", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
      returningIds: ["00000000-0000-0000-0000-000000000ddd"],
    };
    const tx = makeMockTx(state);
    const business = makeBusiness({ vatStatus: "osek_morshe" });
    await expect(
      manualInvoiceProvider.issueInvoice({
        tx,
        business,
        actorUserId: ACTOR_USER_ID,
        invoiceType: "tax_invoice",
        issueDate: "2026-06-01",
        currency: "ILS",
        subtotalMinor: 1_000n,
        vatMinor: 180n,
        totalMinor: 9_999n, // wrong on purpose
        vatRate: "18.00",
        lines: [],
      }),
    ).rejects.toThrow(/does not equal total/);
  });
});
