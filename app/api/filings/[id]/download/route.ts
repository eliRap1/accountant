// GET /api/filings/:id/download
//
// Streams the encrypted regulator-ready file back to the operator after
// a step-up gate.
//
// Pipeline:
//   1. Resolve the active user.
//   2. requireFreshSession({ op: `filing.export_${kind}`, payloadHash })
//      with the filingId in the canonical payload — replay-binds the
//      step-up to this specific row.
//   3. withUser tx → SELECT the row by id. RLS ensures cross-tenant
//      leaks silently 404 (the row isn't visible to the caller).
//   4. Unwrap the DEK, AES-GCM-decrypt the ciphertext, base64-decode
//      to recover the original file bytes.
//   5. Stream the binary with the row's stored MIME and a filename hint
//      derived from kind + period.
//   6. Best-effort: flip the row's status to 'downloaded' if it was
//      'generated' — purely informational; the column doubles as an
//      audit trail.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  requireFreshSession,
  computePayloadHash,
  StepUpRequired,
} from "@/lib/auth/stepUp";
import { decryptStringWithDek } from "@/lib/security/encryption";
import { mapStepUpOpForKind, type FilingKind } from "@/app/[locale]/(app)/filings/types";

export const dynamic = "force-dynamic";

type FilingRow = {
  id: string;
  kind: string;
  status: string;
  fileBlobUrl: string | null;
  fileKeyId: string | null;
  fileMime: string | null;
  periodStart: string;
  periodEnd: string;
};

function extensionFor(kind: FilingKind, mime: string | null): string {
  if (mime?.includes("application/xml")) return "xml";
  if (mime?.includes("application/pdf")) return "pdf";
  if (mime?.includes("text/csv")) return "csv";
  // PCN874 + form_126 default to a windows-1255 text payload — keep .txt
  // so the operator can re-encode in a text editor before upload.
  void kind;
  return "txt";
}

function suggestedFilename(
  kind: FilingKind,
  periodStart: string,
  periodEnd: string,
  mime: string | null,
): string {
  const ext = extensionFor(kind, mime);
  const start = periodStart.replace(/-/g, "");
  const end = periodEnd.replace(/-/g, "");
  return `${kind}_${start}_${end}.${ext}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const me = await requireCurrentUser();

  // Read the row first to know which step-up op to require — the op
  // symbol depends on `kind`.
  const row = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text,
                 kind::text AS kind,
                 status::text AS status,
                 file_blob_url AS "fileBlobUrl",
                 file_key_id::text AS "fileKeyId",
                 file_mime AS "fileMime",
                 period_start::text AS "periodStart",
                 period_end::text AS "periodEnd"
            FROM tax_filings
            WHERE id = ${id}::uuid
            LIMIT 1`,
    )) as unknown as FilingRow[];
    return rows[0] ?? null;
  });

  if (!row) {
    return NextResponse.json(
      { error: "app.filings.errors.notFound" },
      { status: 404 },
    );
  }
  if (!row.fileBlobUrl || !row.fileKeyId) {
    // Generator left a placeholder row but no ciphertext. Most likely a
    // stale draft. Treat as not-found from the caller's perspective.
    return NextResponse.json(
      { error: "app.filings.errors.notFound" },
      { status: 404 },
    );
  }

  const kind = row.kind as FilingKind;

  // Step-up gate. The payload hash binds (filingId, action) so a
  // step-up grant for filing A cannot be replayed for filing B.
  try {
    await requireFreshSession({
      op: mapStepUpOpForKind(kind),
      payloadHash: computePayloadHash({ filingId: id, action: "download" }),
    });
  } catch (err) {
    if (err instanceof StepUpRequired) {
      return NextResponse.json(
        { error: "app.filings.errors.stepUpRequired", op: err.op, payloadHash: err.payloadHash },
        { status: 401 },
      );
    }
    throw err;
  }

  // Decrypt.
  let fileBytes: Buffer;
  try {
    const plaintextB64 = await decryptStringWithDek({
      dekId: row.fileKeyId,
      ciphertext: row.fileBlobUrl,
      aad: { table: "tax_filings", column: "file_ciphertext", rowId: row.id },
    });
    fileBytes = Buffer.from(plaintextB64, "base64");
  } catch {
    return NextResponse.json(
      { error: "app.filings.errors.generic" },
      { status: 500 },
    );
  }

  // Best-effort status flip: generated → downloaded.
  if (row.status === "generated") {
    try {
      await withUser(me.appUserId, async (tx) => {
        await tx.execute(
          sql`UPDATE tax_filings
                SET status = 'downloaded'::tax_filing_status
                WHERE id = ${row.id}::uuid
                  AND status = 'generated'::tax_filing_status`,
        );
      });
    } catch {
      // Best-effort only — never fail the download because of an audit
      // flip we can replay on the next request.
    }
  }

  const mime = row.fileMime ?? "application/octet-stream";
  const filename = suggestedFilename(kind, row.periodStart, row.periodEnd, row.fileMime);

  const arrayBuffer = fileBytes.buffer.slice(
    fileBytes.byteOffset,
    fileBytes.byteOffset + fileBytes.byteLength,
  ) as ArrayBuffer;

  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(fileBytes.byteLength),
      "cache-control": "no-store",
    },
  });
}
