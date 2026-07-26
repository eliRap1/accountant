// Notifications helper for Morning Tax Brief.
//
// One responsibility: idempotently UPSERT a `notifications` row of kind
// 'morning_brief' for a given (user, sentDay). If a row already exists
// for the same (user_id, kind, payload_jsonb.sentDay) — return its id
// without inserting a duplicate. The cron handler runs daily but may
// retry on transient failures; we MUST NOT spam the same user twice.
//
// We also expose a helper to read TODAY's brief, used by the dashboard
// card to surface the latest sentence without re-running the engine.

import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { withUser } from "@/lib/db/withUser";
import type { MorningBriefPayload } from "@/lib/ai/morningBrief";

type ExistingRow = {
  id: string;
};

type LatestRow = {
  id: string;
  payload_jsonb: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

/**
 * Idempotent insert. The cron calls this AFTER it has decided this user
 * should receive a brief today. Same (userId, kind, sentDay) cannot
 * duplicate — second call returns the original id.
 *
 * Uses `withServiceRole` because the cron has no user context yet (RLS
 * would otherwise block this insert without a SET app.current_user_id).
 */
export async function upsertMorningBriefNotification(args: {
  userId: string;
  payload: MorningBriefPayload;
}): Promise<{ id: string; created: boolean }> {
  const sentDay = args.payload.metadata.sentDay;

  return withServiceRole(async (tx) => {
    // Check if there's already a brief for this user × day.
    const existing = (await tx.execute(
      sql`SELECT id FROM notifications
          WHERE user_id = ${args.userId}::uuid
            AND kind = 'morning_brief'
            AND (payload_jsonb->>'sentDay') = ${sentDay}
          LIMIT 1`,
    )) as unknown as ExistingRow[];

    const existingRow = existing[0];
    if (existingRow) {
      return { id: existingRow.id, created: false };
    }

    // Serialise the payload — bigints are not JSON.stringify-safe, so
    // convert to strings. The dashboard card / AI panels parse the
    // strings back to bigints on read.
    const serialised = serialisePayload(args.payload);

    const inserted = (await tx.execute(
      sql`INSERT INTO notifications (user_id, kind, payload_jsonb)
          VALUES (
            ${args.userId}::uuid,
            'morning_brief',
            ${JSON.stringify(serialised)}::jsonb
          )
          RETURNING id`,
    )) as unknown as ExistingRow[];

    const row = inserted[0];
    if (!row) {
      throw new Error(
        "upsertMorningBriefNotification: insert returned no row",
      );
    }
    return { id: row.id, created: true };
  });
}

/**
 * Latest morning_brief for the active user (RLS-scoped). Returns null
 * when the user has no briefs yet — the dashboard card renders an
 * empty-state in that case.
 */
export async function getLatestMorningBrief(
  userId: string,
): Promise<{
  id: string;
  payload: SerialisedPayload;
  createdAt: Date;
  readAt: Date | null;
} | null> {
  return withUser(userId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id, payload_jsonb, created_at::text AS created_at,
                 read_at::text AS read_at
          FROM notifications
          WHERE kind = 'morning_brief'
          ORDER BY created_at DESC
          LIMIT 1`,
    )) as unknown as LatestRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      payload: row.payload_jsonb as SerialisedPayload,
      createdAt: new Date(row.created_at),
      readAt: row.read_at ? new Date(row.read_at) : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// (De)serialisation
// ─────────────────────────────────────────────────────────────────────────

export type SerialisedPayload = {
  he?: string;
  en?: string;
  vatDueMinor: string; // bigint → string
  vatDueDate: string;
  cashOnHandMinor: string;
  cashGapMinor: string;
  actionNext: MorningBriefPayload["actionNext"];
  metadata: {
    sentDay: string;
    hasBusiness: boolean;
    vatPeriodLabel: { he: string; en: string };
    overdueInvoiceCount: number;
    overdueInvoiceTotalMinor: string;
    pendingReceiptCount: number;
    oldestPendingReceipt: {
      vendor: string | null;
      amountMinor: string;
    } | null;
    locale: string;
  };
};

export function serialisePayload(
  payload: MorningBriefPayload,
): SerialisedPayload {
  return {
    ...(payload.he !== undefined ? { he: payload.he } : {}),
    ...(payload.en !== undefined ? { en: payload.en } : {}),
    vatDueMinor: payload.vatDueMinor.toString(),
    vatDueDate: payload.vatDueDate.toISOString(),
    cashOnHandMinor: payload.cashOnHandMinor.toString(),
    cashGapMinor: payload.cashGapMinor.toString(),
    actionNext: payload.actionNext,
    metadata: {
      sentDay: payload.metadata.sentDay,
      hasBusiness: payload.metadata.hasBusiness,
      vatPeriodLabel: payload.metadata.vatPeriodLabel,
      overdueInvoiceCount: payload.metadata.overdueInvoiceCount,
      overdueInvoiceTotalMinor:
        payload.metadata.overdueInvoiceTotalMinor.toString(),
      pendingReceiptCount: payload.metadata.pendingReceiptCount,
      oldestPendingReceipt: payload.metadata.oldestPendingReceipt
        ? {
            vendor: payload.metadata.oldestPendingReceipt.vendor,
            amountMinor:
              payload.metadata.oldestPendingReceipt.amountMinor.toString(),
          }
        : null,
      locale: payload.metadata.locale,
    },
  };
}
