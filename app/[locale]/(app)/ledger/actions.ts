"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";

const lineSchema = z
  .object({
    accountCode: z.string().trim().min(1).max(20),
    debitMinor: z.coerce.number().int().min(0),
    creditMinor: z.coerce.number().int().min(0),
    description: z.string().trim().max(255).optional().or(z.literal("")),
  })
  .refine(
    (l) => (l.debitMinor > 0) !== (l.creditMinor > 0),
    "line must be debit XOR credit",
  );

const entrySchema = z.object({
  businessId: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  lines: z.array(lineSchema).min(2),
});

export type JournalEntryActionResult =
  | { ok: true; id: string }
  | { error: string }
  | { stepUpRequired: { op: string; payloadHash: string } };

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Server Action; payload arrives JSON-encoded (dynamic line list doesn't
// fit cleanly in FormData key/value semantics).
export async function createJournalEntry(payload: {
  businessId: string;
  entryDate: string;
  description?: string;
  lines: Array<{
    accountCode: string;
    debitMinor: number;
    creditMinor: number;
    description?: string;
  }>;
}): Promise<JournalEntryActionResult> {
  const me = await requireCurrentUser();
  const parsed = entrySchema.safeParse(payload);
  if (!parsed.success) return { error: "app.errors.invalidInput" };

  const input = parsed.data;
  const sumDebit = input.lines.reduce((s, l) => s + l.debitMinor, 0);
  const sumCredit = input.lines.reduce((s, l) => s + l.creditMinor, 0);
  if (sumDebit !== sumCredit) {
    return { error: "app.errors.unbalancedEntry" };
  }

  // Council C-3 + Plan v4 § 5.2: year-end-closed periods are immutable.
  // We consult app_period_is_closed (SECURITY DEFINER helper in
  // 0005_rls_layer2.sql) BEFORE the INSERT. If the entry date falls
  // into a closed period, require a fresh step-up grant bound to this
  // exact (businessId, entryDate, lines) tuple — that's the override
  // path for a CPA correcting a prior-year mistake.
  let periodClosed = false;
  await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT app_period_is_closed(${input.businessId}::uuid, ${input.entryDate}::date) AS closed`,
    )) as unknown as Array<{ closed: boolean }>;
    periodClosed = rows[0]?.closed === true;
  });
  if (periodClosed) {
    try {
      await requireFreshSession({
        op: "ledger.post_to_closed_period",
        payloadHash: computePayloadHash({
          businessId: input.businessId,
          entryDate: input.entryDate,
          lines: input.lines.map((l) => ({
            accountCode: l.accountCode,
            debitMinor: l.debitMinor,
            creditMinor: l.creditMinor,
          })),
        }),
      });
    } catch (err) {
      if (err instanceof StepUpRequired) {
        return {
          stepUpRequired: { op: err.op, payloadHash: err.payloadHash },
        };
      }
      throw err;
    }
  }

  try {
    const id = await withUser(me.appUserId, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO journal_entries (
              business_id, entry_date, description, source, created_by_user_id
            ) VALUES (
              ${input.businessId}::uuid,
              ${input.entryDate}::date,
              ${nullIfBlank(input.description ?? null)},
              ${"manual"}::journal_entry_source,
              ${me.appUserId}::uuid
            )
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const entryId = rows[0]?.id;
      if (!entryId) throw new Error("createJournalEntry: no row returned");

      for (const line of input.lines) {
        await tx.execute(
          sql`INSERT INTO journal_lines (
                entry_id, account_code, debit_minor, credit_minor, description
              ) VALUES (
                ${entryId}::uuid,
                ${line.accountCode},
                ${line.debitMinor}::bigint,
                ${line.creditMinor}::bigint,
                ${nullIfBlank(line.description ?? null)}
              )`,
        );
      }

      return entryId;
    });

    revalidatePath("/ledger");
    return { ok: true, id };
  } catch (err) {
    // DB-level balance trigger (ledger layer) fires at COMMIT and would
    // raise the constraint here. Surface a friendly error rather than
    // the raw Postgres message.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unbalanced|debit|credit|check/i.test(msg)) {
      return { error: "app.errors.unbalancedEntry" };
    }
    return { error: "app.errors.invalidInput" };
  }
}
