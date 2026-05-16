// AI SDK v6 tool definitions for the IL tax advisor.
//
// Each tool is a server-side function the model can call to fetch
// ground-truth data. Tools are user-scoped — they all close over the
// caller's `userId` and route through `withUser` (RLS).
//
// Tool schemas use Zod (v4). The `inputSchema` field name comes from
// AI SDK v6 (renamed from `parameters` in v5). Tool execution returns
// any JSON-serialisable value; bigints are stringified to keep the
// JSON wire format clean and reversible.

import { tool } from "ai";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getSpendingByCategory } from "@/lib/aggregations/spendingByCategory";
import { withUser } from "@/lib/db/withUser";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";

/** Serialise bigints to decimal strings for the tool wire format. */
function jsonifyBigints<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonifyBigints);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonifyBigints(v);
    }
    return out;
  }
  return value;
}

export type ToolContext = {
  userId: string;
  /** Optional now-override for deterministic tests. */
  now?: Date;
};

/**
 * `getTaxEstimate(period)` — runs the full tax engine for the active
 * business. The `period` parameter currently only accepts "current_year"
 * because the engine is annualised; Phase E will add "2026Q3" etc.
 */
export function buildGetTaxEstimate(ctx: ToolContext) {
  return tool({
    description:
      "Run the IL tax engine for the user's active business. Returns income tax, VAT-this-period, Bituach Leumi, and מקדמות estimates. ESTIMATES ONLY — disclaimer attached.",
    inputSchema: z.object({
      period: z
        .literal("current_year")
        .describe("Annual estimate for the running tax year."),
    }),
    execute: async ({ period: _period }) => {
      const result = await runFullTaxEngine(ctx.userId, ctx.now ? { now: ctx.now } : {});
      return jsonifyBigints(result);
    },
  });
}

/**
 * `getCashflow(months)` — last N months of revenue + expense + ebitda
 * buckets. Replicates the dashboard chart for AI consumption.
 */
export function buildGetCashflow(ctx: ToolContext) {
  return tool({
    description:
      "Read the last N months of income + expense aggregates for the user's active business. Used to answer cashflow + trend questions.",
    inputSchema: z.object({
      months: z.number().int().min(1).max(24).default(12),
    }),
    execute: async ({ months }) => {
      const startDate = new Date(ctx.now ?? new Date());
      startDate.setUTCMonth(startDate.getUTCMonth() - (months - 1));
      startDate.setUTCDate(1);
      const startIso = startDate.toISOString().slice(0, 10);
      const rows = await withUser(ctx.userId, async (tx) => {
        return (await tx.execute(
          sql`SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month_bucket,
                     direction::text,
                     COALESCE(SUM(amount_minor),0)::text AS total_minor
              FROM transactions
              WHERE txn_date >= ${startIso}::date
              GROUP BY 1, 2
              ORDER BY 1`,
        )) as unknown as Array<{
          month_bucket: string;
          direction: string;
          total_minor: string;
        }>;
      });
      return jsonifyBigints({ months, rows });
    },
  });
}

/**
 * `getOverdueInvoices()` — list invoices with `due_date < today` that
 * are not cancelled. Returns up to 50 rows (any further is paginated
 * outside the AI surface).
 */
export function buildGetOverdueInvoices(ctx: ToolContext) {
  return tool({
    description:
      "List up to 50 overdue invoices for the user's active business — invoices past their due_date that are not cancelled.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(50),
    }),
    execute: async ({ limit }) => {
      const todayIso = (ctx.now ?? new Date()).toISOString().slice(0, 10);
      const rows = await withUser(ctx.userId, async (tx) => {
        return (await tx.execute(
          sql`SELECT id, sequential_number, issue_date::text, due_date::text,
                     total_minor::text, currency_at_issue
              FROM invoices
              WHERE cancelled_at IS NULL
                AND due_date IS NOT NULL
                AND due_date < ${todayIso}::date
                AND invoice_type IN ('tax_invoice','tax_invoice_receipt')
              ORDER BY due_date ASC
              LIMIT ${limit}`,
        )) as unknown as Array<{
          id: string;
          sequential_number: number;
          issue_date: string;
          due_date: string;
          total_minor: string;
          currency_at_issue: string;
        }>;
      });
      return jsonifyBigints({ count: rows.length, invoices: rows });
    },
  });
}

/**
 * `getVatPayableThisPeriod()` — current 2-month VAT period: collected
 * minus recoverable. Returns the same value the dashboard surfaces.
 */
export function buildGetVatPayableThisPeriod(ctx: ToolContext) {
  return tool({
    description:
      "Estimate the user's VAT payable in the current 2-month VAT period (collected VAT minus recoverable VAT). Returns negative-clamped value.",
    inputSchema: z.object({}),
    execute: async () => {
      const result = await runFullTaxEngine(ctx.userId, ctx.now ? { now: ctx.now } : {});
      return jsonifyBigints({
        vatPayableThisPeriodMinor: result.vatPayableThisPeriodMinor,
        disclaimer: result.disclaimer,
      });
    },
  });
}

/**
 * `getMakdamotStatus()` — מקדמות paid YTD, assigned rate, projection
 * for the remainder of the year. Reads `tax_advances` (Phase D Layer 3).
 */
export function buildGetMakdamotStatus(ctx: ToolContext) {
  return tool({
    description:
      "Report מקדמות (advance-tax) status for the active business: assigned rate, YTD paid, projected remainder of year. Returns null fields when the table is not yet provisioned.",
    inputSchema: z.object({}),
    execute: async () => {
      const result = await runFullTaxEngine(ctx.userId, ctx.now ? { now: ctx.now } : {});
      return jsonifyBigints({
        monthlyInstallmentMinor: result.advanceTaxMonthlyInstallmentMinor,
        rateRange: result.advanceTaxRateRange,
        disclaimer: result.disclaimer,
      });
    },
  });
}

/**
 * `getSpendingByCategory(windowDays)` — surfaces the dashboard's
 * spending-by-category donut data to the model so it can answer "what
 * did I spend on X this month" questions.
 */
export function buildGetSpendingByCategory(ctx: ToolContext) {
  return tool({
    description:
      "Group the user's expense transactions by chart-of-accounts category over a rolling window (default 30 days, max 365). Returns top 12 categories with totals in major ILS units.",
    inputSchema: z.object({
      windowDays: z.number().int().min(7).max(365).default(30),
    }),
    execute: async ({ windowDays }) => {
      const result = await getSpendingByCategory(ctx.userId, {
        windowDays,
        ...(ctx.now ? { now: ctx.now } : {}),
      });
      return jsonifyBigints(result);
    },
  });
}

/**
 * Aggregate factory — returns a `ToolSet` (record of tools) keyed by
 * the names the model invokes. Pass directly to `generateText`/
 * `streamText` as the `tools` option.
 */
export function buildAdvisorTools(ctx: ToolContext) {
  return {
    getTaxEstimate: buildGetTaxEstimate(ctx),
    getCashflow: buildGetCashflow(ctx),
    getOverdueInvoices: buildGetOverdueInvoices(ctx),
    getVatPayableThisPeriod: buildGetVatPayableThisPeriod(ctx),
    getMakdamotStatus: buildGetMakdamotStatus(ctx),
    getSpendingByCategory: buildGetSpendingByCategory(ctx),
  } as const;
}

export type AdvisorTools = ReturnType<typeof buildAdvisorTools>;
