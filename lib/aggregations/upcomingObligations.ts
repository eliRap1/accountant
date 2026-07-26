import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { getCurrentVatWindow } from "@/lib/scheduler/businessQuotedRevenueWindow";

// Upcoming obligations: merged chronological timeline of due dates over
// the next 90 days. Five kinds: VAT period close, Bituach Leumi monthly,
// makdamot installments, tax filings, and invoice receivables. Each
// source is wrapped in try/catch so a missing/empty table never breaks
// the timeline; the VAT and Bituach entries are calendar-derived and
// always present.

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

const ANNUAL_FILING_KINDS = new Set([
  "form_6111",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
]);

const MONTHLY_FILING_KINDS = new Set(["pcn874", "form_102"]);

function dueDateForFiling(kind: string, periodEndIso: string): string {
  const periodEnd = new Date(periodEndIso + "T00:00:00Z");
  if (ANNUAL_FILING_KINDS.has(kind)) {
    return new Date(
      Date.UTC(periodEnd.getUTCFullYear() + 1, 3, 30),
    ).toISOString().slice(0, 10);
  }
  if (MONTHLY_FILING_KINDS.has(kind)) {
    return new Date(
      Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 15),
    ).toISOString().slice(0, 10);
  }
  return new Date(periodEnd.getTime() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function isWithin(nowIso: string, dueIso: string, fromOffsetDays: number, toOffsetDays: number): boolean {
  const now = new Date(nowIso + "T00:00:00Z").getTime();
  const due = new Date(dueIso + "T00:00:00Z").getTime();
  return due >= now + fromOffsetDays * 86_400_000 && due <= now + toOffsetDays * 86_400_000;
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
  const filingFloorIso = new Date(now.getTime() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const items: UpcomingObligationItem[] = [];

  const vatWindow = getCurrentVatWindow(now);
  const vatDueIso = vatWindow.dueDate.toISOString().slice(0, 10);
  if (isWithin(todayIso, vatDueIso, -1, windowDays)) {
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
        sql`SELECT id::text, kind::text, period_end::text, status::text
            FROM tax_filings
            WHERE status NOT IN ('submitted')
              AND period_end >= ${filingFloorIso}::date
              AND period_end <= ${limitIso}::date
            ORDER BY period_end ASC`,
      )) as unknown as Array<{
        id: string;
        kind: string;
        period_end: string;
        status: string;
      }>;
      for (const r of rows) {
        const dueIso = dueDateForFiling(r.kind, r.period_end);
        if (!isWithin(todayIso, dueIso, -30, windowDays)) continue;
        items.push({
          id: `fi-${r.id}`,
          kind: "filing",
          label: `${r.kind} ${r.period_end}`,
          dueDateIso: dueIso,
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
