// Stripe webhook idempotency tracker.
//
// Backed by the stripe_webhook_events table (migration 0006). The table
// is service-role-only; callers MUST use withServiceRole to access it.
//
// Pattern:
//   const claim = await claimEvent(event.id, event.type);
//   if (!claim) return ok();   // already processed — return 200 to Stripe
//   try { await handle(event); } catch (e) { ... }
//
// `claimEvent` returns true if THIS process won the race (the row was
// inserted), false if some other process / earlier delivery already
// recorded the event. The INSERT ... ON CONFLICT DO NOTHING + checking
// `rowCount` is atomic at the row level — no transaction needed.

import { sql } from "drizzle-orm";
import { withServiceRole } from "@/lib/db/withServiceRole";

/**
 * Atomically claim a Stripe event for processing.
 *
 * @returns true if this caller claimed the event (proceed to handle it)
 *          false if the event was already claimed by a previous delivery
 */
export async function claimEvent(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  return withServiceRole(async (tx) => {
    const result = (await tx.execute(
      sql`INSERT INTO stripe_webhook_events (id, event_type)
          VALUES (${eventId}, ${eventType})
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return result.length > 0;
  });
}

/**
 * Test-only helper: check whether an event ID has been processed without
 * claiming it. NOT used in the webhook hot path (which uses claimEvent
 * to avoid a TOCTOU window).
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  return withServiceRole(async (tx) => {
    const result = (await tx.execute(
      sql`SELECT 1 FROM stripe_webhook_events WHERE id = ${eventId} LIMIT 1`,
    )) as unknown as Array<unknown>;
    return result.length > 0;
  });
}
