// Morning Tax Brief — data composition layer.
//
// `composeMorningBrief({userId, businessId?, locale})` runs the IL tax
// engine + reads `transactions` / `receipts` / `invoices` via RLS-scoped
// `withUser`, then emits a single MorningBriefPayload that:
//
//   • feeds the email template at lib/email/templates/<locale>/morning-brief.tsx
//   • feeds the in-app card at components/app/dashboard/MorningBriefCard.tsx
//   • feeds the notifications row written by lib/notifications/morningBriefNotifications.ts
//
// IMPORTANT: NO AI / openai / gateway calls in this code path. The brief
// is deterministic — the sentence is templated from the structured
// payload by lib/ai/morningBriefSentence.ts. AI access lands later as
// an upsell ("ask the advisor why VAT is high this month").
//
// Action-next priority (the FIRST one matching wins):
//   1. pay_vat            — VAT due ≤ 7 days AND cashOnHand < vatDue
//   2. follow_up_overdue  — any invoice > 7 days overdue AND unpaid
//   3. categorise_receipts — any receipt status='pending_review'
//   4. pay_vat (fallback) — VAT due ≤ 7 days regardless of cash
//   5. nothing_urgent     — none of the above

import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db/withUser";
import { runFullTaxEngine } from "@/lib/tax/il/runEngineForUser";
import {
  getCurrentVatWindow,
  daysBetween,
} from "@/lib/scheduler/businessQuotedRevenueWindow";
import { renderMorningBriefSentence } from "@/lib/ai/morningBriefSentence";
import type { MorningBriefAction } from "@/lib/ai/morningBriefSentence";
import type { VatStatus } from "@/lib/tax/il/types";

export type MorningBriefPayload = {
  /** Hebrew rendering. Always present when locale starts with "he". */
  he?: string;
  /** English rendering. Always present when locale starts with "en" or "ru". */
  en?: string;
  /** VAT owed in minor units (agorot). 0n if no business / patur / no activity. */
  vatDueMinor: bigint;
  /** Filing deadline. */
  vatDueDate: Date;
  /** Cash on hand (operating accounts only) in minor units. */
  cashOnHandMinor: bigint;
  /** vatDueMinor − cashOnHandMinor, clamped to 0n. */
  cashGapMinor: bigint;
  /** Which next-step the brief is centred on. */
  actionNext: MorningBriefAction;
  /** Additional structured fields — for in-app card details + dashboards. */
  metadata: {
    /** ISO date the brief is FOR (YYYY-MM-DD in UTC). Used for dedupe. */
    sentDay: string;
    /** True when a business exists and at least one transaction or invoice. */
    hasBusiness: boolean;
    /** Period label, e.g. "May-Jun" / "מאי-יוני". */
    vatPeriodLabel: { he: string; en: string };
    /** Overdue invoice tally. */
    overdueInvoiceCount: number;
    overdueInvoiceTotalMinor: bigint;
    /** Pending-review receipts tally. */
    pendingReceiptCount: number;
    /** Oldest pending receipt (vendor masked when ciphertext-only). */
    oldestPendingReceipt: {
      vendor: string | null;
      amountMinor: bigint;
    } | null;
    /** Echoed locale for downstream renderers. */
    locale: string;
  };
};

export type ComposeMorningBriefOptions = {
  userId: string;
  /** Force a specific business (multi-business users). Falls back to the primary. */
  businessId?: string;
  /** "he-IL" | "en-US" | "ru-RU". Maps "ru-RU" → English copy. */
  locale: string;
  /** Recipient first name — used inside the sentence. Optional. */
  userName?: string | null;
  /** Override `now` for tests + cron back-fill. Defaults to new Date(). */
  now?: Date;
};

/**
 * Compute the morning brief for one user. Pure data + deterministic
 * rendering — no AI calls, no quota consumption.
 *
 * On error, returns a "nothing_urgent" payload with zeroed numbers so the
 * cron loop never explodes. Caller should still write a notification row
 * (best-effort: morning briefs are habit-forming; gaps confuse users).
 */
export async function composeMorningBrief(
  opts: ComposeMorningBriefOptions,
): Promise<MorningBriefPayload> {
  const now = opts.now ?? new Date();
  const sentDay = now.toISOString().slice(0, 10);

  // Run the tax engine first — gives us VAT + business id + vat_status.
  const estimate = await runFullTaxEngine(opts.userId, {
    now,
    ...(opts.businessId ? { businessId: opts.businessId } : {}),
  });

  // The engine returns 0n for everything when there's no business. Treat
  // that as the empty-state path so the cron still writes a row (which
  // is helpful for "Have I onboarded?" diagnostics).
  const aggregates = await fetchAggregates({
    userId: opts.userId,
    ...(opts.businessId ? { businessId: opts.businessId } : {}),
    now,
  });

  const window = getCurrentVatWindow(now, aggregates.vatStatus);

  // VAT due = whichever the engine surfaced for the current 2-month
  // period. The engine already clamps negative (refund) cases to 0n.
  const vatDueMinor = estimate.vatPayableThisPeriodMinor;

  // Cash on hand: sum of (opening_balance + signed ledger movement) per
  // operating financial account. For Phase B.2 the dashboard already uses
  // `transactions` as the canonical cash-flow source; mirror that here.
  const cashOnHandMinor = aggregates.cashOnHandMinor;

  const cashGapMinor =
    vatDueMinor > cashOnHandMinor ? vatDueMinor - cashOnHandMinor : 0n;

  const daysUntilDue = daysBetween(now, window.dueDate);

  const actionNext: MorningBriefAction = pickAction({
    vatDueMinor,
    cashOnHandMinor,
    daysUntilDue,
    overdueInvoiceCount: aggregates.overdueInvoiceCount,
    pendingReceiptCount: aggregates.pendingReceiptCount,
  });

  const sentenceInput = {
    locale: opts.locale,
    userName: opts.userName ?? null,
    action: actionNext,
    vatDueMinor,
    vatDueDate: window.dueDate,
    cashOnHandMinor,
    cashGapMinor,
    pendingReceiptCount: aggregates.pendingReceiptCount,
    oldestPendingReceipt: aggregates.oldestPendingReceipt,
    overdueInvoiceCount: aggregates.overdueInvoiceCount,
    overdueInvoiceTotalMinor: aggregates.overdueInvoiceTotalMinor,
  } as const;

  // Always render BOTH languages so the dashboard card + email can pick
  // the right one without re-querying. Costs are negligible.
  const he = renderMorningBriefSentence({ ...sentenceInput, locale: "he-IL" });
  const en = renderMorningBriefSentence({ ...sentenceInput, locale: "en-US" });

  const payload: MorningBriefPayload = {
    he,
    en,
    vatDueMinor,
    vatDueDate: window.dueDate,
    cashOnHandMinor,
    cashGapMinor,
    actionNext,
    metadata: {
      sentDay,
      hasBusiness: aggregates.hasBusiness,
      vatPeriodLabel: { he: window.labelHe, en: window.labelEn },
      overdueInvoiceCount: aggregates.overdueInvoiceCount,
      overdueInvoiceTotalMinor: aggregates.overdueInvoiceTotalMinor,
      pendingReceiptCount: aggregates.pendingReceiptCount,
      oldestPendingReceipt: aggregates.oldestPendingReceipt,
      locale: opts.locale,
    },
  };

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────
// Action-next selection (pure)
// ─────────────────────────────────────────────────────────────────────────

type ActionInputs = {
  vatDueMinor: bigint;
  cashOnHandMinor: bigint;
  daysUntilDue: number;
  overdueInvoiceCount: number;
  pendingReceiptCount: number;
};

/**
 * Priority order — first matching branch wins. Exported for unit tests
 * so the priority can be verified independently of the SQL aggregation.
 */
export function pickAction(i: ActionInputs): MorningBriefAction {
  const vatDueSoon = i.vatDueMinor > 0n && i.daysUntilDue <= 7 && i.daysUntilDue >= -7;
  const cashShort = i.cashOnHandMinor < i.vatDueMinor;

  // 1. pay_vat (urgent) — deadline ≤ 7d AND we don't have the cash.
  if (vatDueSoon && cashShort) return "pay_vat";
  // 2. follow_up_overdue — chase clients FIRST (it directly fixes cash gap
  //    for the NEXT cycle if VAT isn't already burning).
  if (i.overdueInvoiceCount > 0) return "follow_up_overdue";
  // 3. categorise_receipts — habit-forming, lowers VAT estimate.
  if (i.pendingReceiptCount > 0) return "categorise_receipts";
  // 4. pay_vat (fallback) — deadline ≤ 7d but cash covers it.
  if (vatDueSoon) return "pay_vat";
  // 5. nothing_urgent — quiet morning.
  return "nothing_urgent";
}

// ─────────────────────────────────────────────────────────────────────────
// SQL aggregation (RLS-scoped)
// ─────────────────────────────────────────────────────────────────────────

type Aggregates = {
  hasBusiness: boolean;
  vatStatus: VatStatus;
  cashOnHandMinor: bigint;
  overdueInvoiceCount: number;
  overdueInvoiceTotalMinor: bigint;
  pendingReceiptCount: number;
  oldestPendingReceipt: {
    vendor: string | null;
    amountMinor: bigint;
  } | null;
};

type BusinessRow = {
  id: string;
  vat_status: VatStatus;
};

type CashRow = {
  cash_minor: string;
};

type OverdueRow = {
  overdue_count: string;
  overdue_total_minor: string;
};

type PendingReceiptRow = {
  pending_count: string;
};

type OldestPendingRow = {
  amount_minor: string | null;
  vendor: string | null;
};

async function fetchAggregates(args: {
  userId: string;
  businessId?: string;
  now: Date;
}): Promise<Aggregates> {
  const empty: Aggregates = {
    hasBusiness: false,
    vatStatus: "osek_morshe",
    cashOnHandMinor: 0n,
    overdueInvoiceCount: 0,
    overdueInvoiceTotalMinor: 0n,
    pendingReceiptCount: 0,
    oldestPendingReceipt: null,
  };

  return withUser(args.userId, async (tx) => {
    // 1. Pick the active business — explicit option, else the primary
    //    (most recent created, not soft-deleted).
    let business: BusinessRow | null = null;
    if (args.businessId) {
      const rows = (await tx.execute(
        sql`SELECT id, vat_status::text AS vat_status
            FROM businesses
            WHERE id = ${args.businessId} AND deleted_at IS NULL
            LIMIT 1`,
      )) as unknown as BusinessRow[];
      business = rows[0] ?? null;
    } else {
      const rows = (await tx.execute(
        sql`SELECT id, vat_status::text AS vat_status
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1`,
      )) as unknown as BusinessRow[];
      business = rows[0] ?? null;
    }

    if (!business) return empty;

    // 2. Cash on hand — sum of opening_balance per financial_account +
    //    signed sum of transactions (income positive, expense negative).
    //    We exclude "credit_card" / "loan" / "equity" so the number reads
    //    as "money I could spend today".
    //
    //    Phase B.2 dashboardData.ts uses transactions directly; we do the
    //    same here so the two surfaces agree. Filter `txn_date <= today`
    //    so future-dated entries don't inflate cash.
    const today = args.now.toISOString().slice(0, 10);
    let cashOnHandMinor = 0n;
    try {
      const cashRows = (await tx.execute(
        sql`
          WITH opening AS (
            SELECT COALESCE(SUM(opening_balance_minor), 0)::text AS s
              FROM financial_accounts
              WHERE business_id = ${business.id}
                AND closed_at IS NULL
                AND kind IN ('bank','cash')
          ), movement AS (
            SELECT COALESCE(SUM(
              CASE WHEN direction = 'income' THEN amount_minor
                   WHEN direction = 'expense' THEN -amount_minor
                   ELSE 0
              END
            ), 0)::text AS s
              FROM transactions t
              LEFT JOIN financial_accounts fa
                ON fa.id = t.financial_account_id
              WHERE t.business_id = ${business.id}
                AND t.txn_date <= ${today}::date
                AND (fa.kind IS NULL OR fa.kind IN ('bank','cash'))
          )
          SELECT (
            (SELECT s FROM opening)::bigint +
            (SELECT s FROM movement)::bigint
          )::text AS cash_minor
        `,
      )) as unknown as CashRow[];
      cashOnHandMinor = BigInt(cashRows[0]?.cash_minor ?? "0");
      if (cashOnHandMinor < 0n) cashOnHandMinor = 0n;
    } catch {
      // Defensive: if `financial_accounts` view isn't reachable for some
      // RLS reason, fall through to zero rather than crash the cron.
      cashOnHandMinor = 0n;
    }

    // 3. Overdue invoices — due_date < now - 7 days AND not cancelled
    //    AND no linked payment journal entry (treat absence of link as
    //    "unpaid"; Phase C wires the linked_journal_entry).
    const sevenDaysAgoIso = new Date(args.now.getTime() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    let overdueInvoiceCount = 0;
    let overdueInvoiceTotalMinor = 0n;
    try {
      const overdueRows = (await tx.execute(
        sql`SELECT COUNT(*)::text AS overdue_count,
                   COALESCE(SUM(total_minor), 0)::text AS overdue_total_minor
            FROM invoices
            WHERE business_id = ${business.id}
              AND cancelled_at IS NULL
              AND deleted_at IS NULL
              AND due_date IS NOT NULL
              AND due_date < ${sevenDaysAgoIso}::date
              AND linked_journal_entry_id IS NULL
              AND invoice_type IN ('tax_invoice','tax_invoice_receipt')`,
      )) as unknown as OverdueRow[];
      overdueInvoiceCount = Number(overdueRows[0]?.overdue_count ?? "0");
      overdueInvoiceTotalMinor = BigInt(
        overdueRows[0]?.overdue_total_minor ?? "0",
      );
    } catch {
      overdueInvoiceCount = 0;
      overdueInvoiceTotalMinor = 0n;
    }

    // 4. Pending receipts — status = 'pending_review'.
    let pendingReceiptCount = 0;
    try {
      const pendingRows = (await tx.execute(
        sql`SELECT COUNT(*)::text AS pending_count
            FROM receipts
            WHERE business_id = ${business.id}
              AND status = 'pending_review'`,
      )) as unknown as PendingReceiptRow[];
      pendingReceiptCount = Number(pendingRows[0]?.pending_count ?? "0");
    } catch {
      pendingReceiptCount = 0;
    }

    // 5. Oldest pending receipt — for the "Ofer Yogev, ₪380" hint.
    //    Vendor name lives in `parsed_vendor_ciphertext`. We never
    //    decrypt inside this aggregator; surface `null` and let the
    //    rendered sentence say "ספק לא ידוע". Phase D AI advisor is the
    //    surface that decrypts on demand.
    let oldestPendingReceipt: Aggregates["oldestPendingReceipt"] = null;
    if (pendingReceiptCount > 0) {
      try {
        const oldestRows = (await tx.execute(
          sql`SELECT parsed_amount_minor::text AS amount_minor,
                     NULL::text AS vendor
              FROM receipts
              WHERE business_id = ${business.id}
                AND status = 'pending_review'
              ORDER BY COALESCE(parsed_date, created_at::date) ASC NULLS LAST
              LIMIT 1`,
        )) as unknown as OldestPendingRow[];
        const row = oldestRows[0];
        if (row) {
          oldestPendingReceipt = {
            vendor: row.vendor ?? null,
            amountMinor: BigInt(row.amount_minor ?? "0"),
          };
        }
      } catch {
        oldestPendingReceipt = null;
      }
    }

    return {
      hasBusiness: true,
      vatStatus: business.vat_status,
      cashOnHandMinor,
      overdueInvoiceCount,
      overdueInvoiceTotalMinor,
      pendingReceiptCount,
      oldestPendingReceipt,
    };
  });
}

export const __testing = { pickAction };
