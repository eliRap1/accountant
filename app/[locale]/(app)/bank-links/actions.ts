"use server";

// STUB IMPLEMENTATION — Salt Edge integration pending vendor signoff.
// TODO(salt-edge): Replace this stub with a Salt Edge Connect Widget
// redirect. The `connectBank` action should:
//   1. Call Salt Edge /connect_sessions to get a widget URL.
//   2. Redirect the user to that URL.
//   3. Receive the connection result via Salt Edge webhook POST to
//      /api/webhooks/salt-edge and update this row's status + provider_connection_id.
// See docs/superpowers/plans/2026-05-17-openai-parity.md "Phase 3".

import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

const ALLOWED_BANK_SLUGS = [
  "leumi",
  "hapoalim",
  "discount",
  "mizrahi",
  "fibi",
] as const;

type BankSlug = (typeof ALLOWED_BANK_SLUGS)[number];

const BANK_DISPLAY_NAMES: Record<BankSlug, string> = {
  leumi: "Bank Leumi",
  hapoalim: "Bank Hapoalim",
  discount: "Bank Discount",
  mizrahi: "Mizrahi Tefahot",
  fibi: "FIBI",
};

const connectBankSchema = z.object({
  businessId: z.string().uuid(),
  bankSlug: z.enum(ALLOWED_BANK_SLUGS),
});

export type ConnectBankResult =
  | { ok: true; connectionId: string }
  | { error: string };

export async function connectBank(
  businessId: string,
  bankSlug: string,
): Promise<ConnectBankResult> {
  const me = await requireCurrentUser();

  const parsed = connectBankSchema.safeParse({ businessId, bankSlug });
  if (!parsed.success) return { error: "app.errors.invalidInput" };

  const { businessId: bId, bankSlug: slug } = parsed.data;
  const displayName = BANK_DISPLAY_NAMES[slug];

  const result = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO bank_connections (
            business_id, bank_slug, display_name,
            status, provider
          ) VALUES (
            ${bId}::uuid,
            ${slug},
            ${displayName},
            'pending_oauth',
            'stub'
          )
          RETURNING id::text AS id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  });

  if (!result) return { error: "app.errors.invalidInput" };

  revalidatePath("/bank-links");
  return { ok: true, connectionId: result };
}
