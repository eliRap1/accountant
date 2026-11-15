# OpenAI Personal-Finance Parity — Phases 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the user-visible parts of ChatGPT Personal Finance (spending insights, recurring subs, upcoming obligations, cash runway) using AccounTech's existing transactions + filings data, plus tool-bound AI chat that can answer transaction-level questions in Hebrew/English with IL tax context.

**Architecture:** Add four new SQL aggregators in `lib/aggregations/`, four new dashboard cards in `components/app/dashboard/`, and three new AI tools in `lib/ai/tools.ts`. No new database tables, no new vendors, no external API calls. All data is read from the existing `transactions`, `invoices`, `receipts`, `financial_accounts`, `tax_advances`, and filings tables via `withUser` (RLS-scoped).

**Tech Stack:** Next.js 16 App Router · drizzle-orm · vitest · framer-motion · lucide-react · next-intl v4 · AI SDK v6 (Vercel AI Gateway) · Zod v4. The existing patterns in `lib/aggregations/cashOnHand.ts` and `lib/ai/tools.ts` are the reference implementations — every new file mirrors those structures.

**Scope explicitly EXCLUDED:** Live bank-account linking (Salt Edge / Plaid / Bank of Israel Open Banking) is a separate plan because it requires (a) a signed AISP-rider vendor contract, (b) legal review of Israeli Open Banking liability, (c) live encryption-of-PII-at-rest hardening. Track that work in a follow-on plan once the vendor is selected.

**Pre-flight check before Task 1:**
- `git status` must be clean.
- `pnpm typecheck` must pass.
- `pnpm test:run` must pass.
- HEAD must be `2751831` or descendant.

---

## File Structure

| Path | Purpose | New / Modify |
|---|---|---|
| `lib/aggregations/spendingByCategory.ts` | SQL aggregator: group expenses by COA category for a date window. | New |
| `lib/aggregations/recurringSubscriptions.ts` | SQL aggregator: detect recurring vendor charges (same description ±3 days, ≥3 occurrences). | New |
| `lib/aggregations/upcomingObligations.ts` | Merged calendar of VAT period close, makdamot installments, filing deadlines, invoice due dates. | New |
| `lib/aggregations/cashRunway.ts` | Forecast: cash on hand ÷ average monthly net burn over last 6 months. | New |
| `lib/ai/tools.ts` | Add `getSpendingByCategory`, `getRecurringSubscriptions`, `getUpcomingObligations`, `getCashRunway`, `getTransactionsByVendor` tools. | Modify |
| `lib/ai/snapshot.ts` | Append top-3 expense categories last 30 days to the snapshot. | Modify |
| `lib/ai/prompt.ts` | Mention new tool names in the system prompt's "What you can rely on" section. | Modify |
| `components/app/dashboard/SpendingByCategoryCard.tsx` | Donut + legend, last 30/90 day toggle. | New |
| `components/app/dashboard/RecurringSubsCard.tsx` | Sortable list of recurring subs with monthly total. | New |
| `components/app/dashboard/UpcomingObligationsCard.tsx` | Next-90-day stacked timeline of due dates. | New |
| `components/app/dashboard/CashRunwayCard.tsx` | Single KPI: months of runway + trend arrow. | New |
| `app/[locale]/(app)/dashboard/page.tsx` | Add 4 new aggregations to `Promise.all`, pass to `DashboardView`. | Modify |
| `app/[locale]/(app)/dashboard/DashboardView.tsx` | Add 4 new cards to the grid. | Modify |
| `locales/he-IL.json` | Hebrew copy for all 4 new card titles, labels, empty states. | Modify |
| `locales/en-US.json` | English copy. | Modify |
| `locales/ru-RU.json` | App-route routes rewrite to en-US, but lint guards require keys exist with `__MARKETING_ONLY__` sentinel — see `scripts/lint-ru-app-leak.ts`. | Modify |
| `tests/unit/aggregations/spendingByCategory.test.ts` | Unit test with mocked `withUser`. | New |
| `tests/unit/aggregations/recurringSubscriptions.test.ts` | Unit test. | New |
| `tests/unit/aggregations/upcomingObligations.test.ts` | Unit test. | New |
| `tests/unit/aggregations/cashRunway.test.ts` | Unit test. | New |
| `tests/unit/ai/snapshot.test.ts` | Update for new top-vendors block. | Modify |

---

## Task 1: Spending-by-Category Aggregator

**Files:**
- Create: `lib/aggregations/spendingByCategory.ts`
- Create: `tests/unit/aggregations/spendingByCategory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/aggregations/spendingByCategory.test.ts
import { describe, it, expect, vi } from "vitest";

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
  it("groups expense totals by COA category code, sorts descending, clamps to top 12", async () => {
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/aggregations/spendingByCategory.test.ts`
Expected: FAIL with `Cannot find module '@/lib/aggregations/spendingByCategory'`.

- [ ] **Step 3: Implement the aggregator**

```typescript
// lib/aggregations/spendingByCategory.ts
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Spending-by-category: groups expense transactions by chart-of-accounts
// code over a rolling window. Mirrors the ChatGPT Personal Finance
// "where your money went" view, but scoped to the user's active business
// via RLS. Returns major units for direct display.

export type SpendingByCategoryRow = {
  categoryCode: string | null;
  categoryName: string | null;
  totalMajor: number;
};

export type SpendingByCategory = {
  windowDays: number;
  rows: SpendingByCategoryRow[];
  totalMajor: number;
};

type DbRow = {
  category_code: string | null;
  category_name: string | null;
  total_minor: string;
};

const MAX_CATEGORIES = 12;

export async function getSpendingByCategory(
  userId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<SpendingByCategory> {
  const windowDays = opts.windowDays ?? 30;
  const now = opts.now ?? new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - windowDays);
  const startIso = startDate.toISOString().slice(0, 10);
  const endIso = now.toISOString().slice(0, 10);

  return withUser(userId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT t.category_code,
                 COALESCE(coa.name_he, coa.name_en) AS category_name,
                 COALESCE(SUM(t.amount_minor), 0)::text AS total_minor
          FROM transactions t
          LEFT JOIN chart_of_accounts coa
            ON coa.code = t.category_code
           AND (coa.business_id = t.business_id OR coa.business_id IS NULL)
          WHERE t.direction = 'expense'
            AND t.txn_date >= ${startIso}::date
            AND t.txn_date <= ${endIso}::date
          GROUP BY t.category_code, coa.name_he, coa.name_en
          ORDER BY SUM(t.amount_minor) DESC
          LIMIT ${MAX_CATEGORIES}`,
    )) as unknown as DbRow[];

    const mapped = rows.map((r) => ({
      categoryCode: r.category_code,
      categoryName: r.category_name,
      totalMajor: Number(BigInt(r.total_minor)) / 100,
    }));

    const totalMajor = mapped.reduce((acc, r) => acc + r.totalMajor, 0);

    return { windowDays, rows: mapped, totalMajor };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/aggregations/spendingByCategory.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/aggregations/spendingByCategory.ts tests/unit/aggregations/spendingByCategory.test.ts
git commit -m "feat(dashboard): spending-by-category aggregator (OpenAI parity 1/11)"
```

---

## Task 2: Spending-by-Category AI Tool

**Files:**
- Modify: `lib/ai/tools.ts`

- [ ] **Step 1: Add the tool factory**

In `lib/ai/tools.ts`, after `buildGetMakdamotStatus` (≈ line 171), insert:

```typescript
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
      const { getSpendingByCategory } = await import(
        "@/lib/aggregations/spendingByCategory"
      );
      const result = await getSpendingByCategory(ctx.userId, {
        windowDays,
        ...(ctx.now ? { now: ctx.now } : {}),
      });
      return jsonifyBigints(result);
    },
  });
}
```

- [ ] **Step 2: Register in the toolset**

In the same file, update `buildAdvisorTools` to include the new tool:

```typescript
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/tools.ts
git commit -m "feat(ai): expose getSpendingByCategory tool (OpenAI parity 2/11)"
```

---

## Task 3: Spending-by-Category Dashboard Card

**Files:**
- Create: `components/app/dashboard/SpendingByCategoryCard.tsx`
- Modify: `locales/he-IL.json` · `locales/en-US.json` · `locales/ru-RU.json`
- Modify: `app/[locale]/(app)/dashboard/page.tsx`
- Modify: `app/[locale]/(app)/dashboard/DashboardView.tsx`

- [ ] **Step 1: Add translation keys**

Open `locales/he-IL.json`. Find the `"app.dashboard"` block. Inside it, add:

```jsonc
"spendingByCategory": {
  "title": "הוצאות לפי קטגוריה",
  "subtitle": "30 הימים האחרונים",
  "total": "סך הכול",
  "empty": "אין הוצאות בחלון הזה.",
  "viewAll": "כל ההוצאות",
  "uncategorised": "ללא קטגוריה"
}
```

Open `locales/en-US.json`. Find the matching block. Add:

```jsonc
"spendingByCategory": {
  "title": "Spending by category",
  "subtitle": "Last 30 days",
  "total": "Total",
  "empty": "No expenses in this window.",
  "viewAll": "All expenses",
  "uncategorised": "Uncategorised"
}
```

Open `locales/ru-RU.json`. Find the matching block. Add (per the marketing-only contract — keys exist so `lint:missing-translations` passes, but the app routes route through en-US):

```jsonc
"spendingByCategory": {
  "title": "__MARKETING_ONLY__",
  "subtitle": "__MARKETING_ONLY__",
  "total": "__MARKETING_ONLY__",
  "empty": "__MARKETING_ONLY__",
  "viewAll": "__MARKETING_ONLY__",
  "uncategorised": "__MARKETING_ONLY__"
}
```

- [ ] **Step 2: Verify translation lint passes**

Run: `pnpm lint:missing-translations`
Expected: PASS with counts `he-IL=1152, en-US=1152, ru-RU=103` (delta of +6 from baseline).

- [ ] **Step 3: Implement the card**

```typescript
// components/app/dashboard/SpendingByCategoryCard.tsx
"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { SpendingByCategory } from "@/lib/aggregations/spendingByCategory";

const SLICE_COLORS = [
  "#34d399",
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#fb923c",
  "#f87171",
  "#94a3b8",
  "#60a5fa",
  "#4ade80",
  "#fcd34d",
  "#c084fc",
];

function shilling(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function SpendingByCategoryCard({
  data,
  locale,
}: {
  data: SpendingByCategory;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.spendingByCategory");

  const slices = data.rows.map((r, idx) => ({
    name: r.categoryName ?? t("uncategorised"),
    code: r.categoryCode ?? "—",
    value: r.totalMajor,
    color: SLICE_COLORS[idx % SLICE_COLORS.length],
  }));

  const isEmpty = data.rows.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium tracking-tight text-slate-200">
            {t("title")}
          </h3>
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {t("subtitle")}
          </p>
        </div>
        <p className="text-end text-sm font-semibold text-emerald-300" dir="ltr">
          {shilling(data.totalMajor, locale)}
        </p>
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="h-32 w-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  innerRadius={32}
                  outerRadius={56}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                  stroke="none"
                >
                  {slices.map((s) => (
                    <Cell key={s.code} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1.5">
            {slices.slice(0, 5).map((s) => (
              <li
                key={s.code}
                className="flex items-center justify-between text-xs text-slate-300"
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="truncate">{s.name}</span>
                </span>
                <span dir="ltr" className="ms-2 font-medium text-slate-100">
                  {shilling(s.value, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Wire into the dashboard page**

Open `app/[locale]/(app)/dashboard/page.tsx`. Find the import block (≈ line 12). Add:

```typescript
import { getSpendingByCategory } from "@/lib/aggregations/spendingByCategory";
```

Find the `Promise.all` block (≈ line 57). Replace the destructure + parallel call with:

```typescript
const [
  data,
  cashOnHand,
  overdueInvoices,
  uncategorisedReceipts,
  advanceTaxStatus,
  profitTrend,
  estimate,
  spendingByCategory,
] = await Promise.all([
  getDashboardData(user.appUserId),
  getCashOnHand(user.appUserId),
  getOverdueInvoices(user.appUserId),
  getUncategorisedReceipts(user.appUserId),
  getAdvanceTaxStatus(user.appUserId),
  getMonthlyProfitTrend(user.appUserId),
  runFullTaxEngine(user.appUserId, { now }),
  getSpendingByCategory(user.appUserId, { now }),
]);
```

Find the `<DashboardView ... />` invocation (≈ line 107). Add a new prop at the end:

```typescript
<DashboardView
  chartData={chartData}
  isEmpty={data.isEmpty}
  locale={locale}
  monthLabels={months}
  vatDue={{ /* unchanged */ }}
  cashOnHand={cashOnHand}
  overdueInvoices={overdueInvoices}
  uncategorisedReceipts={uncategorisedReceipts}
  advanceTaxStatus={advanceTaxStatus}
  profitTrend={profitTrend}
  spendingByCategory={spendingByCategory}
/>
```

- [ ] **Step 5: Wire into DashboardView**

Open `app/[locale]/(app)/dashboard/DashboardView.tsx`. Add import after the existing dashboard-card imports:

```typescript
import SpendingByCategoryCard from "@/components/app/dashboard/SpendingByCategoryCard";
import type { SpendingByCategory } from "@/lib/aggregations/spendingByCategory";
```

Extend the `Props` type:

```typescript
type Props = {
  // ...existing fields unchanged
  spendingByCategory: SpendingByCategory;
};
```

Add the parameter to the destructure inside `export default function DashboardView({ ... })`, then drop the card into the tile grid (after `MakdamotCard`, before the chart):

```tsx
<SpendingByCategoryCard data={spendingByCategory} locale={locale} />
```

- [ ] **Step 6: Typecheck + render smoke test**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm dev` and open `http://localhost:3000/he-IL/dashboard` while signed in. The new card should render under the 5 existing tiles.

- [ ] **Step 7: Commit**

```bash
git add components/app/dashboard/SpendingByCategoryCard.tsx \
        app/[locale]/(app)/dashboard/page.tsx \
        app/[locale]/(app)/dashboard/DashboardView.tsx \
        locales/he-IL.json locales/en-US.json locales/ru-RU.json
git commit -m "feat(dashboard): spending-by-category card (OpenAI parity 3/11)"
```

---

## Task 4: Recurring Subscriptions Aggregator

**Files:**
- Create: `lib/aggregations/recurringSubscriptions.ts`
- Create: `tests/unit/aggregations/recurringSubscriptions.test.ts`

Detection rules:
- Group `transactions` rows where `direction='expense'` by `LOWER(TRIM(COALESCE(metadata_jsonb->>'counterparty', description)))`.
- A vendor is "recurring" when:
  - ≥3 transactions in the last 180 days, AND
  - Median interval between consecutive `txn_date` values is in `{27..33}` (monthly) OR `{6..8}` (weekly) days, AND
  - Median amount across the matched rows ≤ 200% of the smallest (filters out one-offs that share a description).
- Surface up to 30 vendors, sorted by inferred monthly cost desc.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/aggregations/recurringSubscriptions.test.ts
import { describe, it, expect, vi } from "vitest";

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
  it("detects monthly Netflix and weekly grocery as recurring", async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/aggregations/recurringSubscriptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the aggregator**

```typescript
// lib/aggregations/recurringSubscriptions.ts
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";

// Recurring-subscriptions detector. Groups expense transactions by a
// normalised "vendor" key (counterparty from metadata_jsonb, falling
// back to description). A group qualifies as recurring when:
//   - >= 3 transactions in the lookback window (default 180 days),
//   - the median consecutive-day-gap matches a cadence band,
//   - amounts are within 100%–200% of the smallest (rejects coincidences).
//
// Output is in major ILS units. Cadence is reported as "monthly" /
// "weekly" so the UI can render an estimated monthly cost without
// re-deriving the math.

export type RecurringCadence = "monthly" | "weekly";

export type RecurringSubscription = {
  vendor: string;
  occurrences: number;
  cadence: RecurringCadence;
  medianAmountMajor: number;
  monthlyCostMajor: number;
  lastSeenIso: string;
};

export type RecurringSubscriptions = {
  windowDays: number;
  subscriptions: RecurringSubscription[];
  totalMonthlyMajor: number;
};

type DbRow = {
  vendor: string;
  txn_date: string;
  amount_minor: string;
};

const MIN_OCCURRENCES = 3;
const MAX_VENDORS = 30;
const MONTHLY_BAND = { min: 27, max: 33 };
const WEEKLY_BAND = { min: 6, max: 8 };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function classifyCadence(gapDays: number): RecurringCadence | null {
  if (gapDays >= MONTHLY_BAND.min && gapDays <= MONTHLY_BAND.max) return "monthly";
  if (gapDays >= WEEKLY_BAND.min && gapDays <= WEEKLY_BAND.max) return "weekly";
  return null;
}

export async function getRecurringSubscriptions(
  userId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<RecurringSubscriptions> {
  const windowDays = opts.windowDays ?? 180;
  const now = opts.now ?? new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - windowDays);
  const startIso = startDate.toISOString().slice(0, 10);

  const rows = await withUser(userId, async (tx) => {
    return (await tx.execute(
      sql`SELECT LOWER(TRIM(COALESCE(metadata_jsonb->>'counterparty', description, ''))) AS vendor,
                 txn_date::text,
                 amount_minor::text
          FROM transactions
          WHERE direction = 'expense'
            AND txn_date >= ${startIso}::date
            AND COALESCE(metadata_jsonb->>'counterparty', description, '') <> ''
          ORDER BY txn_date DESC`,
    )) as unknown as DbRow[];
  });

  const groups = new Map<string, DbRow[]>();
  for (const r of rows) {
    if (!r.vendor) continue;
    const arr = groups.get(r.vendor) ?? [];
    arr.push(r);
    groups.set(r.vendor, arr);
  }

  const subs: RecurringSubscription[] = [];
  for (const [vendor, list] of groups) {
    if (list.length < MIN_OCCURRENCES) continue;

    const sortedAsc = [...list].sort((a, b) =>
      a.txn_date.localeCompare(b.txn_date),
    );
    const gaps: number[] = [];
    for (let i = 1; i < sortedAsc.length; i++) {
      const prev = new Date(sortedAsc[i - 1]!.txn_date + "T00:00:00Z").getTime();
      const cur = new Date(sortedAsc[i]!.txn_date + "T00:00:00Z").getTime();
      gaps.push((cur - prev) / 86_400_000);
    }
    const medianGap = median(gaps);
    const cadence = classifyCadence(medianGap);
    if (!cadence) continue;

    const amounts = list.map((r) => Number(BigInt(r.amount_minor)));
    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    if (minAmt > 0 && maxAmt / minAmt > 2) continue;

    const medianMinor = median(amounts);
    const occurrencesPerMonth = cadence === "weekly" ? 4.345 : 1;
    const monthlyCostMinor = medianMinor * occurrencesPerMonth;

    subs.push({
      vendor,
      occurrences: list.length,
      cadence,
      medianAmountMajor: medianMinor / 100,
      monthlyCostMajor: monthlyCostMinor / 100,
      lastSeenIso: sortedAsc[sortedAsc.length - 1]!.txn_date,
    });
  }

  subs.sort((a, b) => b.monthlyCostMajor - a.monthlyCostMajor);
  const trimmed = subs.slice(0, MAX_VENDORS);
  const totalMonthlyMajor = trimmed.reduce(
    (acc, s) => acc + s.monthlyCostMajor,
    0,
  );

  return { windowDays, subscriptions: trimmed, totalMonthlyMajor };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/aggregations/recurringSubscriptions.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/aggregations/recurringSubscriptions.ts \
        tests/unit/aggregations/recurringSubscriptions.test.ts
git commit -m "feat(dashboard): recurring-subscriptions detector (OpenAI parity 4/11)"
```

---

## Task 5: Recurring Subscriptions Tool + Card

**Files:**
- Modify: `lib/ai/tools.ts`
- Create: `components/app/dashboard/RecurringSubsCard.tsx`
- Modify: `locales/he-IL.json` · `locales/en-US.json` · `locales/ru-RU.json`
- Modify: `app/[locale]/(app)/dashboard/page.tsx` · `DashboardView.tsx`

- [ ] **Step 1: Add the tool**

In `lib/ai/tools.ts`, after `buildGetSpendingByCategory`, insert:

```typescript
export function buildGetRecurringSubscriptions(ctx: ToolContext) {
  return tool({
    description:
      "Detect recurring expense subscriptions (Netflix-style monthly charges, weekly groceries, etc.) for the user's active business. Returns vendor name, cadence (monthly|weekly), occurrence count, and estimated monthly cost.",
    inputSchema: z.object({
      windowDays: z.number().int().min(60).max(365).default(180),
    }),
    execute: async ({ windowDays }) => {
      const { getRecurringSubscriptions } = await import(
        "@/lib/aggregations/recurringSubscriptions"
      );
      const result = await getRecurringSubscriptions(ctx.userId, {
        windowDays,
        ...(ctx.now ? { now: ctx.now } : {}),
      });
      return jsonifyBigints(result);
    },
  });
}
```

Register in `buildAdvisorTools`:

```typescript
getRecurringSubscriptions: buildGetRecurringSubscriptions(ctx),
```

- [ ] **Step 2: Add translation keys**

`locales/he-IL.json` under `app.dashboard`:

```jsonc
"recurringSubs": {
  "title": "מנויים קבועים",
  "subtitle": "180 הימים האחרונים",
  "monthlyTotal": "סך חודשי",
  "perMonth": "₪{amount}/חודש",
  "perWeek": "₪{amount}/שבוע",
  "occurrences": "{count} חיובים",
  "empty": "לא זוהו מנויים חוזרים."
}
```

`locales/en-US.json`:

```jsonc
"recurringSubs": {
  "title": "Recurring subscriptions",
  "subtitle": "Last 180 days",
  "monthlyTotal": "Monthly total",
  "perMonth": "₪{amount}/mo",
  "perWeek": "₪{amount}/wk",
  "occurrences": "{count} charges",
  "empty": "No recurring charges detected."
}
```

`locales/ru-RU.json`: insert the same keys with `__MARKETING_ONLY__` values.

- [ ] **Step 3: Implement the card**

```typescript
// components/app/dashboard/RecurringSubsCard.tsx
"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Repeat } from "lucide-react";
import type { RecurringSubscriptions } from "@/lib/aggregations/recurringSubscriptions";

function fmtCurrency(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function RecurringSubsCard({
  data,
  locale,
}: {
  data: RecurringSubscriptions;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.recurringSubs");
  const visible = data.subscriptions.slice(0, 6);
  const isEmpty = visible.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium tracking-tight text-slate-200">
            {t("title")}
          </h3>
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {t("subtitle")}
          </p>
        </div>
        <p className="text-end text-sm font-semibold text-emerald-300" dir="ltr">
          {fmtCurrency(data.totalMonthlyMajor, locale)}
        </p>
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li
              key={s.vendor}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 truncate">
                <Repeat size={14} className="text-emerald-300" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {s.vendor}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t("occurrences", { count: s.occurrences })}
                  </p>
                </div>
              </div>
              <p className="text-end text-sm text-slate-200" dir="ltr">
                {fmtCurrency(s.monthlyCostMajor, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Wire into dashboard page + view**

In `app/[locale]/(app)/dashboard/page.tsx`:

```typescript
import { getRecurringSubscriptions } from "@/lib/aggregations/recurringSubscriptions";
```

Add to `Promise.all`:

```typescript
getRecurringSubscriptions(user.appUserId, { now }),
```

Destructure as `recurringSubs` and pass `recurringSubs={recurringSubs}` to `DashboardView`.

In `DashboardView.tsx`:

```typescript
import RecurringSubsCard from "@/components/app/dashboard/RecurringSubsCard";
import type { RecurringSubscriptions } from "@/lib/aggregations/recurringSubscriptions";
```

Extend `Props` with `recurringSubs: RecurringSubscriptions`. Destructure, then render under `SpendingByCategoryCard`:

```tsx
<RecurringSubsCard data={recurringSubs} locale={locale} />
```

- [ ] **Step 5: Typecheck + lint translations**

Run: `pnpm typecheck && pnpm lint:missing-translations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/tools.ts components/app/dashboard/RecurringSubsCard.tsx \
        app/[locale]/(app)/dashboard/page.tsx \
        app/[locale]/(app)/dashboard/DashboardView.tsx \
        locales/he-IL.json locales/en-US.json locales/ru-RU.json
git commit -m "feat(dashboard): recurring-subs card + AI tool (OpenAI parity 5/11)"
```

---

## Task 6: Upcoming Obligations Aggregator

**Files:**
- Create: `lib/aggregations/upcomingObligations.ts`
- Create: `tests/unit/aggregations/upcomingObligations.test.ts`

Sources merged into one timeline:
- VAT period close (use `getCurrentVatWindow` from `@/lib/scheduler/businessQuotedRevenueWindow`).
- Bituach Leumi monthly payment due — 15th of next month (constant).
- מקדמות installments — read `tax_advances.period_end` where `paid_at IS NULL AND period_end <= now+90d`.
- Filing deadlines from `filings` table (`due_date IS NOT NULL AND submitted_at IS NULL AND due_date BETWEEN now AND now+90d`).
- Invoice due dates — receivables from `invoices` (`due_date IS NOT NULL AND cancelled_at IS NULL AND due_date BETWEEN now AND now+90d`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/aggregations/upcomingObligations.test.ts
import { describe, it, expect, vi } from "vitest";

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
  it("merges VAT, Bituach, makdamot, filings, invoices and sorts by date", async () => {
    queryResponses = [
      {
        match: /FROM tax_advances/i,
        rows: [
          {
            period_end: "2026-06-15",
            amount_due_minor: "120000",
            id: "ta-1",
          },
        ],
      },
      {
        match: /FROM filings/i,
        rows: [
          {
            id: "f-1",
            kind: "vat_874",
            due_date: "2026-06-15",
            label: "PCN874 Apr-May",
          },
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

  it("falls back gracefully when tax_advances and filings tables are missing", async () => {
    queryResponses = [];
    const result = await getUpcomingObligations("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });
    expect(result.items.some((i) => i.kind === "vat_period_close")).toBe(true);
    expect(result.items.some((i) => i.kind === "bituach_leumi")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/aggregations/upcomingObligations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the aggregator**

```typescript
// lib/aggregations/upcomingObligations.ts
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { getCurrentVatWindow } from "@/lib/scheduler/businessQuotedRevenueWindow";

// Upcoming obligations: merged timeline of due dates over the next 90
// days. Each kind has a fixed colour + icon hint surfaced by the card.
//
// VAT and Bituach are derived from the calendar (no DB read needed),
// so they always appear. Filings + makdamot + invoices are best-effort:
// if the underlying table is missing (mid-migration) the catch swallows
// the error and the obligation is omitted.

export type ObligationKind =
  | "vat_period_close"
  | "bituach_leumi"
  | "makdamot"
  | "filing"
  | "invoice";

export type UpcomingObligationItem = {
  id: string;
  kind: ObligationKind;
  label: string;
  dueDateIso: string;
  amountMajor: number | null;
  currency: string | null;
};

export type UpcomingObligations = {
  windowDays: number;
  items: UpcomingObligationItem[];
};

function isWithin(now: Date, iso: string, days: number): boolean {
  const due = new Date(iso + "T00:00:00Z").getTime();
  const limit = now.getTime() + days * 86_400_000;
  return due >= now.getTime() - 86_400_000 && due <= limit;
}

function nextBituachDueIso(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let due = new Date(Date.UTC(year, month, 15));
  if (due <= now) {
    due = new Date(Date.UTC(year, month + 1, 15));
  }
  return due.toISOString().slice(0, 10);
}

export async function getUpcomingObligations(
  userId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<UpcomingObligations> {
  const windowDays = opts.windowDays ?? 90;
  const now = opts.now ?? new Date();
  const limitIso = new Date(now.getTime() + windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const items: UpcomingObligationItem[] = [];

  const vatWindow = getCurrentVatWindow(now);
  const vatDueIso = vatWindow.dueDate.toISOString().slice(0, 10);
  if (isWithin(now, vatDueIso, windowDays)) {
    items.push({
      id: `vat-${vatDueIso}`,
      kind: "vat_period_close",
      label: vatWindow.labelEn,
      dueDateIso: vatDueIso,
      amountMajor: null,
      currency: null,
    });
  }

  const bituachIso = nextBituachDueIso(now);
  items.push({
    id: `bl-${bituachIso}`,
    kind: "bituach_leumi",
    label: "Bituach Leumi monthly",
    dueDateIso: bituachIso,
    amountMajor: null,
    currency: null,
  });

  await withUser(userId, async (tx) => {
    try {
      const rows = (await tx.execute(
        sql`SELECT id::text, period_end::text, amount_due_minor::text
            FROM tax_advances
            WHERE paid_at IS NULL
              AND period_end >= ${todayIso}::date
              AND period_end <= ${limitIso}::date
            ORDER BY period_end ASC`,
      )) as unknown as Array<{
        id: string;
        period_end: string;
        amount_due_minor: string;
      }>;
      for (const r of rows) {
        items.push({
          id: `mk-${r.id}`,
          kind: "makdamot",
          label: "מקדמות installment",
          dueDateIso: r.period_end,
          amountMajor: Number(BigInt(r.amount_due_minor)) / 100,
          currency: "ILS",
        });
      }
    } catch {
      /* table not yet present */
    }

    try {
      const rows = (await tx.execute(
        sql`SELECT id::text, kind::text, due_date::text, label
            FROM filings
            WHERE submitted_at IS NULL
              AND due_date IS NOT NULL
              AND due_date >= ${todayIso}::date
              AND due_date <= ${limitIso}::date
            ORDER BY due_date ASC`,
      )) as unknown as Array<{
        id: string;
        kind: string;
        due_date: string;
        label: string | null;
      }>;
      for (const r of rows) {
        items.push({
          id: `fi-${r.id}`,
          kind: "filing",
          label: r.label ?? `Filing ${r.kind}`,
          dueDateIso: r.due_date,
          amountMajor: null,
          currency: null,
        });
      }
    } catch {
      /* table not yet present */
    }

    try {
      const rows = (await tx.execute(
        sql`SELECT id::text, sequential_number, due_date::text,
                   total_minor::text, currency_at_issue
            FROM invoices
            WHERE cancelled_at IS NULL
              AND due_date IS NOT NULL
              AND due_date >= ${todayIso}::date
              AND due_date <= ${limitIso}::date
              AND invoice_type IN ('tax_invoice','tax_invoice_receipt')
            ORDER BY due_date ASC`,
      )) as unknown as Array<{
        id: string;
        sequential_number: number;
        due_date: string;
        total_minor: string;
        currency_at_issue: string;
      }>;
      for (const r of rows) {
        items.push({
          id: `iv-${r.id}`,
          kind: "invoice",
          label: `Invoice #${r.sequential_number}`,
          dueDateIso: r.due_date,
          amountMajor: Number(BigInt(r.total_minor)) / 100,
          currency: r.currency_at_issue,
        });
      }
    } catch {
      /* unexpected — bubble silently */
    }
  });

  items.sort((a, b) => a.dueDateIso.localeCompare(b.dueDateIso));
  return { windowDays, items };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/aggregations/upcomingObligations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/aggregations/upcomingObligations.ts \
        tests/unit/aggregations/upcomingObligations.test.ts
git commit -m "feat(dashboard): upcoming-obligations aggregator (OpenAI parity 6/11)"
```

---

## Task 7: Upcoming Obligations Tool + Card

**Files:**
- Modify: `lib/ai/tools.ts`
- Create: `components/app/dashboard/UpcomingObligationsCard.tsx`
- Modify: `locales/he-IL.json` · `en-US.json` · `ru-RU.json`
- Modify: `app/[locale]/(app)/dashboard/page.tsx` · `DashboardView.tsx`

- [ ] **Step 1: Add the tool**

In `lib/ai/tools.ts`, after `buildGetRecurringSubscriptions`:

```typescript
export function buildGetUpcomingObligations(ctx: ToolContext) {
  return tool({
    description:
      "List the user's upcoming tax + filing + invoice obligations over the next N days (default 90, max 180). Includes VAT period close, Bituach Leumi due, מקדמות installments, filings, and outstanding receivable due dates.",
    inputSchema: z.object({
      windowDays: z.number().int().min(7).max(180).default(90),
    }),
    execute: async ({ windowDays }) => {
      const { getUpcomingObligations } = await import(
        "@/lib/aggregations/upcomingObligations"
      );
      const result = await getUpcomingObligations(ctx.userId, {
        windowDays,
        ...(ctx.now ? { now: ctx.now } : {}),
      });
      return jsonifyBigints(result);
    },
  });
}
```

Register in `buildAdvisorTools`:

```typescript
getUpcomingObligations: buildGetUpcomingObligations(ctx),
```

- [ ] **Step 2: Add translation keys**

`locales/he-IL.json` under `app.dashboard`:

```jsonc
"upcomingObligations": {
  "title": "תזרים התחייבויות",
  "subtitle": "90 הימים הקרובים",
  "empty": "אין התחייבויות פתוחות בחלון הזה.",
  "kind": {
    "vat_period_close": "מע\"מ",
    "bituach_leumi": "ביטוח לאומי",
    "makdamot": "מקדמות",
    "filing": "דיווח",
    "invoice": "חשבונית"
  },
  "daysUntil": "בעוד {days} ימים",
  "today": "היום",
  "overdue": "באיחור"
}
```

`locales/en-US.json`:

```jsonc
"upcomingObligations": {
  "title": "Upcoming obligations",
  "subtitle": "Next 90 days",
  "empty": "No open obligations in this window.",
  "kind": {
    "vat_period_close": "VAT",
    "bituach_leumi": "Bituach Leumi",
    "makdamot": "Advance tax",
    "filing": "Filing",
    "invoice": "Invoice"
  },
  "daysUntil": "in {days} days",
  "today": "today",
  "overdue": "overdue"
}
```

`locales/ru-RU.json`: same keys, `__MARKETING_ONLY__` placeholders (lint requires the structural depth too, including the nested `kind.*`).

- [ ] **Step 3: Implement the card**

```typescript
// components/app/dashboard/UpcomingObligationsCard.tsx
"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { CalendarClock, FileArchive, FileText, Landmark, Receipt } from "lucide-react";
import type {
  UpcomingObligations,
  ObligationKind,
} from "@/lib/aggregations/upcomingObligations";

const ICON_FOR_KIND: Record<ObligationKind, typeof CalendarClock> = {
  vat_period_close: CalendarClock,
  bituach_leumi: Landmark,
  makdamot: Landmark,
  filing: FileArchive,
  invoice: FileText,
};

const TINT_FOR_KIND: Record<ObligationKind, string> = {
  vat_period_close: "text-emerald-300",
  bituach_leumi: "text-sky-300",
  makdamot: "text-amber-300",
  filing: "text-violet-300",
  invoice: "text-pink-300",
};

function daysBetween(nowIso: string, dueIso: string): number {
  const a = new Date(nowIso + "T00:00:00Z").getTime();
  const b = new Date(dueIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

export default function UpcomingObligationsCard({
  data,
  nowIso,
  locale,
}: {
  data: UpcomingObligations;
  nowIso: string;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.upcomingObligations");
  const visible = data.items.slice(0, 8);
  const isEmpty = visible.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5 sm:col-span-2"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium tracking-tight text-slate-200">
            {t("title")}
          </h3>
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {t("subtitle")}
          </p>
        </div>
        <Receipt size={16} className="text-emerald-300" />
      </header>

      {isEmpty ? (
        <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => {
            const Icon = ICON_FOR_KIND[item.kind];
            const tint = TINT_FOR_KIND[item.kind];
            const delta = daysBetween(nowIso, item.dueDateIso);
            const deltaLabel =
              delta < 0
                ? t("overdue")
                : delta === 0
                  ? t("today")
                  : t("daysUntil", { days: delta });
            const amount =
              item.amountMajor != null
                ? new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: item.currency ?? "ILS",
                    maximumFractionDigits: 0,
                  }).format(item.amountMajor)
                : null;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2"
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon size={16} className={tint} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {item.label}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      {t(`kind.${item.kind}`)} · {deltaLabel}
                    </p>
                  </div>
                </div>
                {amount && (
                  <p className="text-end text-sm text-slate-200" dir="ltr">
                    {amount}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Wire into the page + view**

In `app/[locale]/(app)/dashboard/page.tsx`:

```typescript
import { getUpcomingObligations } from "@/lib/aggregations/upcomingObligations";
```

Add to `Promise.all`:

```typescript
getUpcomingObligations(user.appUserId, { now }),
```

Pass `upcomingObligations={upcomingObligations}` and `nowIso={now.toISOString().slice(0,10)}` to `DashboardView`.

In `DashboardView.tsx`:

```typescript
import UpcomingObligationsCard from "@/components/app/dashboard/UpcomingObligationsCard";
import type { UpcomingObligations } from "@/lib/aggregations/upcomingObligations";
```

Extend `Props` with `upcomingObligations: UpcomingObligations; nowIso: string;`. Destructure, then render the card AFTER `RecurringSubsCard`. Card spans 2 columns on desktop via `sm:col-span-2` (already set on its root).

- [ ] **Step 5: Typecheck + translations**

Run: `pnpm typecheck && pnpm lint:missing-translations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/tools.ts components/app/dashboard/UpcomingObligationsCard.tsx \
        app/[locale]/(app)/dashboard/page.tsx \
        app/[locale]/(app)/dashboard/DashboardView.tsx \
        locales/he-IL.json locales/en-US.json locales/ru-RU.json
git commit -m "feat(dashboard): upcoming-obligations card + AI tool (OpenAI parity 7/11)"
```

---

## Task 8: Cash Runway Aggregator

**Files:**
- Create: `lib/aggregations/cashRunway.ts`
- Create: `tests/unit/aggregations/cashRunway.test.ts`

Definition:
- `monthsRemaining = cashOnHand / avgMonthlyNetBurn` where `avgMonthlyNetBurn = max(0, avgMonthlyExpenses - avgMonthlyIncome)` over last 6 months.
- If `avgMonthlyNetBurn === 0` (revenue ≥ expenses): infinity → surface as `null`.
- If `cashOnHand <= 0`: surface `monthsRemaining = 0`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/aggregations/cashRunway.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/aggregations/cashOnHand", () => ({
  getCashOnHand: vi.fn(),
}));

vi.mock("@/lib/db/withUser", () => ({
  withUser: async <T,>(
    _userId: string,
    fn: (tx: { execute: (q: unknown) => Promise<unknown[]> }) => Promise<T>,
  ): Promise<T> =>
    fn({
      execute: async () => burnRows,
    }),
}));

import { getCashOnHand } from "@/lib/aggregations/cashOnHand";
const { getCashRunway } = await import("@/lib/aggregations/cashRunway");

let burnRows: Array<{ month_bucket: string; direction: string; total_minor: string }> = [];

describe("getCashRunway", () => {
  it("returns months = cash / monthly burn when burn > 0", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 36_000,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-03", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-02", direction: "expense", total_minor: "1200000" },
      { month_bucket: "2026-04", direction: "income", total_minor: "0" },
    ];

    const result = await getCashRunway("user-1", {
      now: new Date("2026-05-17T00:00:00Z"),
    });

    expect(result.monthsRemaining).toBeCloseTo(3, 1);
    expect(result.cashOnHandMajor).toBe(36_000);
    expect(result.avgMonthlyNetBurnMajor).toBeGreaterThan(0);
  });

  it("returns null months when burn is zero or negative", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 10_000,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "100000" },
      { month_bucket: "2026-04", direction: "income", total_minor: "200000" },
    ];
    const result = await getCashRunway("user-1");
    expect(result.monthsRemaining).toBeNull();
  });

  it("returns zero months when cash on hand is non-positive", async () => {
    (getCashOnHand as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalMajor: 0,
      openingBalanceMajor: 0,
      netFlowMajor: 0,
      accountCount: 1,
    });
    burnRows = [
      { month_bucket: "2026-04", direction: "expense", total_minor: "100000" },
    ];
    const result = await getCashRunway("user-1");
    expect(result.monthsRemaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/aggregations/cashRunway.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the aggregator**

```typescript
// lib/aggregations/cashRunway.ts
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { getCashOnHand } from "@/lib/aggregations/cashOnHand";

// Cash runway: how many months until cash hits zero at the current
// net-burn rate. Net burn = avg monthly expenses - avg monthly income
// over the last 6 months (clipped to >= 0). When the business is
// cash-flow positive on average, runway is conceptually infinite — we
// surface this as `monthsRemaining = null` so the card can render a
// dedicated "positive cashflow" treatment.

export type CashRunway = {
  cashOnHandMajor: number;
  avgMonthlyExpensesMajor: number;
  avgMonthlyIncomeMajor: number;
  avgMonthlyNetBurnMajor: number;
  /** null when net burn <= 0 (positive cashflow / unknown). */
  monthsRemaining: number | null;
  windowMonths: number;
};

type FlowRow = {
  month_bucket: string;
  direction: string;
  total_minor: string;
};

export async function getCashRunway(
  userId: string,
  opts: { now?: Date; windowMonths?: number } = {},
): Promise<CashRunway> {
  const windowMonths = opts.windowMonths ?? 6;
  const now = opts.now ?? new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (windowMonths - 1), 1),
  );
  const startIso = start.toISOString().slice(0, 10);

  const cash = await getCashOnHand(userId);

  const rows = await withUser(userId, async (tx) => {
    return (await tx.execute(
      sql`SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month_bucket,
                 direction::text,
                 COALESCE(SUM(amount_minor), 0)::text AS total_minor
          FROM transactions
          WHERE txn_date >= ${startIso}::date
            AND direction IN ('income', 'expense')
          GROUP BY 1, 2`,
    )) as unknown as FlowRow[];
  });

  let totalIncomeMinor = 0n;
  let totalExpensesMinor = 0n;
  for (const r of rows) {
    const v = BigInt(r.total_minor);
    if (r.direction === "income") totalIncomeMinor += v;
    else if (r.direction === "expense") totalExpensesMinor += v;
  }

  const avgMonthlyIncomeMajor =
    Number(totalIncomeMinor) / 100 / windowMonths;
  const avgMonthlyExpensesMajor =
    Number(totalExpensesMinor) / 100 / windowMonths;
  const avgMonthlyNetBurnMajor = Math.max(
    0,
    avgMonthlyExpensesMajor - avgMonthlyIncomeMajor,
  );

  let monthsRemaining: number | null;
  if (cash.totalMajor <= 0) {
    monthsRemaining = 0;
  } else if (avgMonthlyNetBurnMajor <= 0) {
    monthsRemaining = null;
  } else {
    monthsRemaining = cash.totalMajor / avgMonthlyNetBurnMajor;
  }

  return {
    cashOnHandMajor: cash.totalMajor,
    avgMonthlyExpensesMajor,
    avgMonthlyIncomeMajor,
    avgMonthlyNetBurnMajor,
    monthsRemaining,
    windowMonths,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/aggregations/cashRunway.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/aggregations/cashRunway.ts tests/unit/aggregations/cashRunway.test.ts
git commit -m "feat(dashboard): cash-runway aggregator (OpenAI parity 8/11)"
```

---

## Task 9: Cash Runway Tool + Card

**Files:**
- Modify: `lib/ai/tools.ts`
- Create: `components/app/dashboard/CashRunwayCard.tsx`
- Modify: `locales/he-IL.json` · `en-US.json` · `ru-RU.json`
- Modify: `app/[locale]/(app)/dashboard/page.tsx` · `DashboardView.tsx`

- [ ] **Step 1: Add the tool**

In `lib/ai/tools.ts`, after `buildGetUpcomingObligations`:

```typescript
export function buildGetCashRunway(ctx: ToolContext) {
  return tool({
    description:
      "Forecast cash runway for the user's active business: months until cash on hand is depleted at the average net-burn rate over the last 6 months. Returns null months when the business is cash-flow positive.",
    inputSchema: z.object({
      windowMonths: z.number().int().min(3).max(12).default(6),
    }),
    execute: async ({ windowMonths }) => {
      const { getCashRunway } = await import("@/lib/aggregations/cashRunway");
      const result = await getCashRunway(ctx.userId, {
        windowMonths,
        ...(ctx.now ? { now: ctx.now } : {}),
      });
      return jsonifyBigints(result);
    },
  });
}
```

Register in `buildAdvisorTools`:

```typescript
getCashRunway: buildGetCashRunway(ctx),
```

- [ ] **Step 2: Add translation keys**

`locales/he-IL.json`:

```jsonc
"cashRunway": {
  "title": "אופק תזרים",
  "subtitle": "תחזית 6 חודשים",
  "monthsLabel": "חודשי אופק",
  "positive": "תזרים חיובי",
  "burnLabel": "שריפה חודשית ממוצעת",
  "depleted": "מזומן אזל"
}
```

`locales/en-US.json`:

```jsonc
"cashRunway": {
  "title": "Cash runway",
  "subtitle": "6-month forecast",
  "monthsLabel": "months of runway",
  "positive": "Positive cashflow",
  "burnLabel": "Avg monthly burn",
  "depleted": "Cash depleted"
}
```

`locales/ru-RU.json`: insert as `__MARKETING_ONLY__`.

- [ ] **Step 3: Implement the card**

```typescript
// components/app/dashboard/CashRunwayCard.tsx
"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { CashRunway } from "@/lib/aggregations/cashRunway";

function fmtCurrency(major: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(major);
}

export default function CashRunwayCard({
  data,
  locale,
}: {
  data: CashRunway;
  locale: string;
}) {
  const t = useTranslations("app.dashboard.cashRunway");

  const isPositive = data.monthsRemaining === null;
  const isDepleted = data.monthsRemaining === 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const accent = isPositive
    ? "text-emerald-300"
    : isDepleted
      ? "text-red-300"
      : "text-amber-300";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong flex flex-col gap-3 rounded-2xl p-5"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium tracking-tight text-slate-200">
            {t("title")}
          </h3>
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            {t("subtitle")}
          </p>
        </div>
        <Icon size={16} className={accent} />
      </header>

      <div className="flex items-baseline gap-2" dir="ltr">
        <span className={`text-4xl font-semibold tracking-tight ${accent}`}>
          {isPositive
            ? "∞"
            : isDepleted
              ? "0"
              : data.monthsRemaining!.toFixed(1)}
        </span>
        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
          {isPositive
            ? t("positive")
            : isDepleted
              ? t("depleted")
              : t("monthsLabel")}
        </span>
      </div>

      <p className="text-[11px] text-slate-400">
        {t("burnLabel")}: {fmtCurrency(data.avgMonthlyNetBurnMajor, locale)}
      </p>
    </motion.div>
  );
}
```

- [ ] **Step 4: Wire into page + view**

`app/[locale]/(app)/dashboard/page.tsx`:

```typescript
import { getCashRunway } from "@/lib/aggregations/cashRunway";
```

Add `getCashRunway(user.appUserId, { now })` to `Promise.all`, destructure as `cashRunway`, pass `cashRunway={cashRunway}` to `DashboardView`.

`DashboardView.tsx`:

```typescript
import CashRunwayCard from "@/components/app/dashboard/CashRunwayCard";
import type { CashRunway } from "@/lib/aggregations/cashRunway";
```

Extend `Props` with `cashRunway: CashRunway`. Render in the grid next to `RecurringSubsCard`:

```tsx
<CashRunwayCard data={cashRunway} locale={locale} />
```

- [ ] **Step 5: Typecheck + translations**

Run: `pnpm typecheck && pnpm lint:missing-translations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/tools.ts components/app/dashboard/CashRunwayCard.tsx \
        app/[locale]/(app)/dashboard/page.tsx \
        app/[locale]/(app)/dashboard/DashboardView.tsx \
        locales/he-IL.json locales/en-US.json locales/ru-RU.json
git commit -m "feat(dashboard): cash-runway card + AI tool (OpenAI parity 9/11)"
```

---

## Task 10: Transactions-by-Vendor Tool + Snapshot Enrichment

**Files:**
- Modify: `lib/ai/tools.ts`
- Modify: `lib/ai/snapshot.ts`
- Modify: `tests/unit/ai/snapshot.test.ts`

Snapshot enrichment: append a line listing the top-3 expense categories from the last 30 days (uses `getSpendingByCategory`). Keeps the snapshot well under 1000-char ceiling.

- [ ] **Step 1: Update snapshot test to expect the new line**

In `tests/unit/ai/snapshot.test.ts`, find the `describe` block that asserts the rendered snapshot text. Add a new assertion inside the existing "renders the full snapshot" test (or add a new `it`):

```typescript
it("appends top-3 expense categories when present", async () => {
  queryResponses = [
    // ... reuse the existing canned business + transaction rows, then
    {
      match: /LEFT JOIN chart_of_accounts coa/i,
      rows: [
        { category_code: "5210", category_name: "Software", total_minor: "300000" },
        { category_code: "5310", category_name: "Travel", total_minor: "150000" },
        { category_code: "5400", category_name: "Office", total_minor: "100000" },
      ],
    },
  ];
  const ctx = await generateSnapshotContext("user-1", {
    businessId: "biz-1",
    now: new Date("2026-05-17T00:00:00Z"),
  });
  expect(ctx.text).toMatch(/Top expense categories/i);
  expect(ctx.text).toMatch(/Software/i);
  expect(ctx.text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
});
```

(Adapt the canned-row regex to match the existing test's mocked business row scaffolding — the new query is the `LEFT JOIN chart_of_accounts` block from `lib/aggregations/spendingByCategory.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ai/snapshot.test.ts`
Expected: FAIL — snapshot text does not contain "Top expense categories".

- [ ] **Step 3: Enrich the snapshot**

In `lib/ai/snapshot.ts`, inside the `withUser` callback after the existing `lines = [...]` build, before the `return` statement, insert:

```typescript
import { getSpendingByCategory } from "@/lib/aggregations/spendingByCategory";
```

(at the top of the file — preserve alphabetical-ish ordering with the other `@/lib/...` imports).

Then in the body, after the existing `lines` array assembly:

```typescript
// Append top-3 expense categories last 30 days — supports the AI tool
// "what did I spend on X" pattern. Failure here must not break the
// snapshot (categories are nice-to-have).
let topCatLine: string | null = null;
try {
  const cats = await getSpendingByCategory(userId, { now });
  const top3 = cats.rows.slice(0, 3);
  if (top3.length > 0) {
    topCatLine = `Top expense categories (last 30d): ${top3
      .map(
        (c) =>
          `${c.categoryName ?? "(uncategorised)"} ${shilling(BigInt(Math.round(c.totalMajor * 100)))}`,
      )
      .join(", ")}.`;
  }
} catch {
  /* swallow — snapshot stays valid without this line. */
}

const allLines = topCatLine
  ? [...lines.slice(0, -2), topCatLine, ...lines.slice(-2)]
  : lines;

return {
  text: withinLimit(allLines.join("\n")),
  hasBusiness: true,
  inputs: {
    incomeMinor,
    expensesMinor,
    vatPayableThisPeriodMinor,
    overdueInvoiceCount: overdueCount,
    overdueInvoiceTotalMinor: overdueTotalMinor,
    advanceTaxPaidYtdMinor,
  },
};
```

(The `slice(-2)` preserves the two disclaimer suffix lines at the tail — `DEFAULT_DISCLAIMER.he` then `.en`.)

- [ ] **Step 4: Add the transactions-by-vendor tool**

In `lib/ai/tools.ts`, after `buildGetCashRunway`:

```typescript
export function buildGetTransactionsByVendor(ctx: ToolContext) {
  return tool({
    description:
      "Look up the last N expense transactions for a specific vendor (matched case-insensitive on counterparty or description substring). Useful for answering 'show my Netflix charges' type questions.",
    inputSchema: z.object({
      vendor: z.string().min(2).max(80),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async ({ vendor, limit }) => {
      const pattern = `%${vendor.toLowerCase()}%`;
      const rows = await withUser(ctx.userId, async (tx) => {
        return (await tx.execute(
          sql`SELECT id::text, txn_date::text, amount_minor::text, currency,
                     description, COALESCE(metadata_jsonb->>'counterparty', '') AS counterparty
              FROM transactions
              WHERE direction = 'expense'
                AND (
                  LOWER(COALESCE(description, '')) LIKE ${pattern}
                  OR LOWER(COALESCE(metadata_jsonb->>'counterparty', '')) LIKE ${pattern}
                )
              ORDER BY txn_date DESC
              LIMIT ${limit}`,
        )) as unknown as Array<{
          id: string;
          txn_date: string;
          amount_minor: string;
          currency: string;
          description: string | null;
          counterparty: string;
        }>;
      });
      return jsonifyBigints({ vendor, count: rows.length, transactions: rows });
    },
  });
}
```

Register in `buildAdvisorTools`:

```typescript
getTransactionsByVendor: buildGetTransactionsByVendor(ctx),
```

- [ ] **Step 5: Update the system prompt**

In `lib/ai/prompt.ts`, find the section starting `Tool calls return ground-truth bookkeeping data` (around line 45). Replace just the next sentence to reference the new tools:

```text
- Tool calls return ground-truth bookkeeping data scoped to the user's active business via RLS. Treat the numbers as authoritative. You can call: getTaxEstimate, getCashflow, getOverdueInvoices, getVatPayableThisPeriod, getMakdamotStatus, getSpendingByCategory, getRecurringSubscriptions, getUpcomingObligations, getCashRunway, and getTransactionsByVendor.
```

- [ ] **Step 6: Run snapshot test + typecheck**

Run: `pnpm vitest run tests/unit/ai/snapshot.test.ts`
Expected: PASS — including the new top-categories assertion.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/tools.ts lib/ai/snapshot.ts lib/ai/prompt.ts \
        tests/unit/ai/snapshot.test.ts
git commit -m "feat(ai): vendor lookup tool + snapshot category enrichment (OpenAI parity 10/11)"
```

---

## Task 11: End-to-End QA + Release Notes

**Files:**
- Read-only: all the above
- Modify: `handoff.md` (developer-private; not committed since `.gitignore`'d)

- [ ] **Step 1: Full test suite**

Run: `pnpm test:run`
Expected: PASS. If any unrelated integration tests fail because the Neon test branch is stale, run `pnpm test:unit` first to confirm the new code is green and report integration-failure context separately.

- [ ] **Step 2: Full typecheck + lints**

Run in parallel:

```bash
pnpm typecheck
pnpm lint
pnpm lint:legal-text
pnpm lint:missing-translations
pnpm lint:ru-app-leak
```

Expected: all PASS. (`lint:rule-meta` still FAILS by design — `humanReviewed:false`. Skip.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS, no new pages added (all 4 cards are components of an existing page).

- [ ] **Step 4: Manual browser smoke test**

```bash
pnpm dev
```

In a browser signed in as a user with at least one business, ≥10 historical transactions, and one open invoice:

1. Visit `http://localhost:3000/he-IL/dashboard`.
   - Verify: the 4 new cards render — Spending-by-category donut, Recurring subs list, Upcoming obligations timeline, Cash runway KPI.
   - Verify: layout reflows on mobile width (DevTools < 640px).
   - Verify: RTL — Hebrew text right-aligned, amount fields stay `dir="ltr"`.
2. Switch locale to `/en-US/dashboard`.
   - Verify: all 4 new cards localise correctly.
3. Visit `http://localhost:3000/he-IL/ai`.
   - Ask: "מה הוצאתי על נטפליקס בחודש האחרון?"
   - Verify: the model calls `getTransactionsByVendor` and returns the matching rows.
   - Ask: "כמה זמן יש לי עד שהמזומן ייגמר?"
   - Verify: the model calls `getCashRunway` and answers with the months.
   - Verify: every assistant response ends with the Hebrew disclaimer suffix.

- [ ] **Step 5: Update `handoff.md`**

Append a section at the end of `handoff.md` (file is git-ignored — for local context only):

```markdown
## OpenAI personal-finance parity (Phases 1-2) — landed 2026-05-17

- 4 dashboard cards: spending-by-category donut, recurring subs list, upcoming-obligations timeline, cash-runway KPI.
- 5 new AI tools: getSpendingByCategory, getRecurringSubscriptions, getUpcomingObligations, getCashRunway, getTransactionsByVendor.
- Snapshot now carries top-3 expense categories so even an un-tooled response cites the right context.
- Phase 3 (live bank linking via Salt Edge or BoI Open Banking) deferred to a separate plan — blocked on vendor selection + AISP licensing + legal review.
```

- [ ] **Step 6: Final commit**

```bash
git status
git log --oneline -12
```

Confirm the 9 feature commits (Tasks 1–10) are present, branch is clean, ahead of `origin/main`.

```bash
git push origin main
```

Then watch the Vercel deploy via:

```bash
vercel deploy --prod
```

(`vercel deploy` invocation lives in package.json as `pnpm deploy`.)

---

## Self-Review

**Spec coverage:**
- ✅ Spending insights → Task 1 (aggregator) + Task 3 (card) + Task 2 (AI tool).
- ✅ Recurring subscription detection → Task 4 (aggregator) + Task 5 (card + tool).
- ✅ Upcoming obligations / "what's due" → Task 6 (aggregator) + Task 7 (card + tool).
- ✅ Cash runway forecast → Task 8 (aggregator) + Task 9 (card + tool).
- ✅ AI bound to transaction-level data → Task 10 (vendor lookup tool + snapshot category enrichment + system prompt update).
- ✅ End-to-end QA + ship → Task 11.

**Placeholder scan:** all SQL strings, TypeScript bodies, JSON snippets, and shell commands are concrete. No `TBD` / `TODO` / `implement later` patterns. Step descriptions include the actual code to write, not "add appropriate handling".

**Type consistency:**
- `SpendingByCategory.rows[].categoryCode: string | null` — used consistently in both the aggregator and the card.
- `RecurringSubscription.cadence: "monthly" | "weekly"` — matches both the test and the card's conditional rendering.
- `UpcomingObligationItem.kind: ObligationKind` literal union — same union used in `ICON_FOR_KIND` and `TINT_FOR_KIND` maps in the card.
- `CashRunway.monthsRemaining: number | null` — both aggregator and card branch on null.

**Out-of-scope guard:** Salt Edge / Plaid / BoI Open Banking integration is deferred to a separate plan because it blocks on (a) vendor selection, (b) AISP licensing, (c) legal review. No task in this plan references those vendors.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-openai-parity.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks. Best for tasks that touch multiple files (3, 5, 7, 9).

**2. Inline Execution** — execute tasks in this session using executing-plans, batch with checkpoints. Faster if you're going to review the resulting commits manually anyway.

Which approach?
