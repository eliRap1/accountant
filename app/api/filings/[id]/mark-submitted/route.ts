// POST /api/filings/:id/mark-submitted
//
// Mirrors the `markSubmitted` Server Action but is exposed via a route
// handler for clients that prefer a fetch-based flow (e.g. modal forms
// that post JSON). The body shape is:
//
//   { asmachta?: string }  (max 128 chars; whitespace is trimmed)
//
// Step-up gate: requireFreshSession({op:`filing.export_${kind}`, payloadHash}).
// On success: returns { ok: true, id }. On step-up: returns 401 with
// {op, payloadHash} so the client can POST /api/auth/step-up + retry.

import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import { mapStepUpOpForKind, type FilingKind } from "@/app/[locale]/(app)/filings/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  asmachta: z
    .string()
    .trim()
    .max(128)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

type Row = { kind: string; status: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const me = await requireCurrentUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "app.filings.errors.generic" },
      { status: 400 },
    );
  }
  const asmachta = parsed.data.asmachta;

  const row = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT kind::text AS kind, status::text AS status
            FROM tax_filings
            WHERE id = ${id}::uuid
            LIMIT 1`,
    )) as unknown as Row[];
    return rows[0] ?? null;
  });
  if (!row) {
    return NextResponse.json(
      { error: "app.filings.errors.notFound" },
      { status: 404 },
    );
  }
  if (row.status === "submitted") {
    return NextResponse.json(
      { error: "app.filings.errors.alreadySubmitted" },
      { status: 409 },
    );
  }

  const kind = row.kind as FilingKind;
  try {
    await requireFreshSession({
      op: mapStepUpOpForKind(kind),
      payloadHash: computePayloadHash({ filingId: id, action: "mark_submitted" }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return NextResponse.json(
        {
          error: "app.filings.errors.stepUpRequired",
          op: err.op,
          payloadHash: err.payloadHash,
        },
        { status: 401 },
      );
    }
    throw err;
  }

  await withUser(me.appUserId, async (tx) => {
    await tx.execute(
      sql`UPDATE tax_filings
            SET status = 'submitted'::tax_filing_status,
                submitted_at = now(),
                submitted_asmachta = ${asmachta}
            WHERE id = ${id}::uuid`,
    );
  });

  return NextResponse.json({ ok: true, id });
}
