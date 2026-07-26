import { describe, it, expect } from "vitest";
import {
  nextInvoiceSequence,
  recordSequenceFailure,
  recordGapDetected,
} from "@/lib/invoices/sequential";
import type { DrizzleTx } from "@/lib/invoices/sequential";

// Light-weight mock of the Drizzle PgTransaction surface we actually use:
//   - tx.execute(sql`...`)          -> Promise<rows>
//   - tx.update(table).set(...).where(...) -> Promise
//   - tx.insert(table).values(...) -> Promise
//
// We capture every call and let the test feed back synthetic row data
// for the SELECT step. Mock is intentionally typed loose because the
// production code's Drizzle generics blow up under any naive stub.

type MockState = {
  selectRows: Array<Record<string, unknown>>;
  executeCalls: string[];
  updateCalls: Array<{ values: Record<string, unknown> }>;
  insertCalls: Array<{ table: string; values: Record<string, unknown> }>;
};

function sqlChunksToString(query: unknown): string {
  // drizzle's sql`...` returns an object with a `queryChunks` array. Each
  // chunk is either a string-fragment ({ value: [string] }) or a bound
  // parameter (any). Joining the string-fragments reconstructs the
  // template literal source so we can test for substring matches.
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
  const tx = {
    execute: async (_query: unknown) => {
      // Record every execute. The SELECT step returns whatever the test
      // queued up; SELECT pg_advisory_xact_lock returns [].
      const queryStr = sqlChunksToString(_query);
      state.executeCalls.push(queryStr);
      if (queryStr.includes("next_invoice_sequence_jsonb")) {
        return state.selectRows;
      }
      return [];
    },
    update: (_table: { _: { name?: string } }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_pred: unknown) => {
          state.updateCalls.push({ values });
          return undefined;
        },
      }),
    }),
    insert: (table: { _: { name?: string } }) => ({
      values: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const tableName = table?._?.name ?? "<unknown>";
        const valArr = Array.isArray(values) ? values : [values];
        for (const v of valArr) {
          state.insertCalls.push({ table: tableName, values: v });
        }
        return [];
      },
    }),
  };
  // We deliberately cast through `unknown` — DrizzleTx's full generic
  // surface is far larger than what these tests exercise.
  return tx as unknown as DrizzleTx;
}

const BUSINESS_ID = "00000000-0000-0000-0000-000000000001";
const ACTOR_USER_ID = "00000000-0000-0000-0000-0000000000aa";

describe("nextInvoiceSequence", () => {
  it("returns 1 on a fresh business with no prior counter", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    const seq = await nextInvoiceSequence({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "tax_invoice",
      actorUserId: ACTOR_USER_ID,
    });
    expect(seq).toBe(1);
  });

  it("increments existing counter for the chosen invoice type", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: { tax_invoice: 42, receipt: 17 } }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    const seq = await nextInvoiceSequence({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "tax_invoice",
      actorUserId: ACTOR_USER_ID,
    });
    expect(seq).toBe(43);
  });

  it("writes back the incremented counter while preserving other types", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: { tax_invoice: 10, receipt: 5 } }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await nextInvoiceSequence({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "tax_invoice",
      actorUserId: ACTOR_USER_ID,
    });
    expect(state.updateCalls.length).toBe(1);
    const jsonb = state.updateCalls[0]!.values["nextInvoiceSequenceJsonb"] as
      | { tax_invoice?: number; receipt?: number }
      | undefined;
    expect(jsonb).toBeDefined();
    expect(jsonb?.tax_invoice).toBe(11);
    // The receipt counter must be carried over verbatim.
    expect(jsonb?.receipt).toBe(5);
  });

  it("acquires the advisory transaction lock BEFORE the SELECT", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: {} }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await nextInvoiceSequence({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "receipt",
      actorUserId: ACTOR_USER_ID,
    });
    const lockIdx = state.executeCalls.findIndex((q) =>
      q.includes("pg_advisory_xact_lock"),
    );
    const selectIdx = state.executeCalls.findIndex((q) =>
      q.includes("next_invoice_sequence_jsonb"),
    );
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(selectIdx);
  });

  it("inserts an audit row with outcome='committed' inside the same tx", async () => {
    const state: MockState = {
      selectRows: [{ jsonb: { tax_invoice: 99 } }],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await nextInvoiceSequence({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "tax_invoice",
      actorUserId: ACTOR_USER_ID,
    });
    expect(state.insertCalls.length).toBe(1);
    const audit = state.insertCalls[0]!.values;
    expect(audit["businessId"]).toBe(BUSINESS_ID);
    expect(audit["invoiceType"]).toBe("tax_invoice");
    expect(audit["attemptedSequence"]).toBe(100);
    expect(audit["outcome"]).toBe("committed");
    expect(audit["actorUserId"]).toBe(ACTOR_USER_ID);
  });

  it("throws when the business does not exist", async () => {
    const state: MockState = {
      selectRows: [],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await expect(
      nextInvoiceSequence({
        tx,
        businessId: BUSINESS_ID,
        invoiceType: "tax_invoice",
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("recordSequenceFailure / recordGapDetected", () => {
  it("recordSequenceFailure writes outcome='rolled_back'", async () => {
    const state: MockState = {
      selectRows: [],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await recordSequenceFailure({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "tax_invoice",
      attemptedSequence: 7,
      actorUserId: ACTOR_USER_ID,
    });
    expect(state.insertCalls.length).toBe(1);
    expect(state.insertCalls[0]!.values["outcome"]).toBe("rolled_back");
    expect(state.insertCalls[0]!.values["attemptedSequence"]).toBe(7);
  });

  it("recordGapDetected writes outcome='gap_detected'", async () => {
    const state: MockState = {
      selectRows: [],
      executeCalls: [],
      updateCalls: [],
      insertCalls: [],
    };
    const tx = makeMockTx(state);
    await recordGapDetected({
      tx,
      businessId: BUSINESS_ID,
      invoiceType: "credit_note",
      attemptedSequence: 12,
      actorUserId: ACTOR_USER_ID,
    });
    expect(state.insertCalls.length).toBe(1);
    expect(state.insertCalls[0]!.values["outcome"]).toBe("gap_detected");
    expect(state.insertCalls[0]!.values["invoiceType"]).toBe("credit_note");
  });
});
