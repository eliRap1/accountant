// POST /api/receipts/parse
//
// Body: { id: string } — the receipts row to OCR.
//
// Flow:
//   1. Authenticate.
//   2. Load the row + business; verify RLS visibility.
//   3. Fetch + decrypt the blob bytes via the row's fileKeyId.
//   4. Run extractReceipt() (vision OCR through Vercel AI Gateway).
//   5. Encrypt the parsed vendor + raw OCR JSON, persist parsed_* fields.
//
// If OCR returns null (model timeout, gateway disabled, invalid output),
// we leave the row as-is (pending_review, parsed fields NULL) and
// return 200 so the client UI can show "OCR unavailable — fill in
// manually". The upload step never gets rolled back.

import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { fetchAndDecryptReceiptBlob } from "@/lib/receipts/storage";
import { extractReceipt } from "@/lib/receipts/ocr";
import { encryptStringWithDek } from "@/lib/security/encryption";
import { isAiGatewayEnabled } from "@/lib/ai/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id?: unknown };

type ReceiptRow = {
  id: string;
  businessId: string;
  fileBlobUrl: string | null;
  fileKeyId: string | null;
  contentTypeHint: string | null;
};

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : null;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  if (!isAiGatewayEnabled()) {
    // Surface the disabled-gateway case cleanly so the client can show
    // a "manual entry only" hint instead of treating it as a hard error.
    return Response.json(
      { ok: true, ocrApplied: false, reason: "ai_gateway_disabled" },
      { status: 200 },
    );
  }

  const row = await withUser(user.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text,
                 business_id::text AS "businessId",
                 file_blob_url AS "fileBlobUrl",
                 file_key_id::text AS "fileKeyId",
                 NULL::text AS "contentTypeHint"
            FROM receipts
            WHERE id = ${id}::uuid LIMIT 1`,
    )) as unknown as ReceiptRow[];
    return rows[0] ?? null;
  });
  if (!row || !row.fileBlobUrl || !row.fileKeyId) {
    return Response.json({ error: "receipt_not_found" }, { status: 404 });
  }

  // Decrypt the blob bytes.
  let buffer: Buffer;
  try {
    buffer = await fetchAndDecryptReceiptBlob({
      blobUrl: row.fileBlobUrl,
      receiptId: row.id,
      fileKeyId: row.fileKeyId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api.receipts.parse] decrypt failed", err);
    return Response.json({ error: "decrypt_failed" }, { status: 500 });
  }

  // The MIME type is not persisted on the row today — we infer from the
  // first few bytes (magic number sniff). Image vs PDF is the only
  // distinction the OCR layer cares about.
  const mimeType = sniffMime(buffer) ?? "image/jpeg";

  const ocr = await extractReceipt(buffer, mimeType);
  if (!ocr) {
    return Response.json(
      { ok: true, ocrApplied: false, reason: "ocr_failed" },
      { status: 200 },
    );
  }

  // Persist parsed_* fields + encrypt the vendor name under the
  // per-business DEK. Raw OCR text + items are stored in
  // ocr_text_ciphertext (concatenated description + amount list).
  const vendorEnc = await encryptStringWithDek({
    purpose: `business:${row.businessId}:receipt_vendor`,
    plaintext: ocr.vendor,
    aad: {
      table: "receipts",
      column: "parsed_vendor_ciphertext",
      rowId: row.id,
    },
  });

  const ocrText = serialiseOcrForText(ocr);
  const ocrTextEnc = await encryptStringWithDek({
    purpose: `business:${row.businessId}:receipt_ocr_text`,
    plaintext: ocrText,
    aad: {
      table: "receipts",
      column: "ocr_text_ciphertext",
      rowId: row.id,
    },
  });

  await withUser(user.appUserId, async (tx) => {
    await tx.execute(
      sql`UPDATE receipts
            SET parsed_amount_minor = ${ocr.amount_minor.toString()}::bigint,
                parsed_vat_minor = ${ocr.vat_minor === null ? null : ocr.vat_minor.toString()}::bigint,
                parsed_date = ${ocr.date}::date,
                parsed_vendor_ciphertext = ${vendorEnc.ciphertext},
                ocr_text_ciphertext = ${ocrTextEnc.ciphertext},
                updated_at = NOW()
          WHERE id = ${row.id}::uuid`,
    );
  });

  return Response.json({
    ok: true,
    ocrApplied: true,
    vendor: ocr.vendor,
    amount_minor: ocr.amount_minor.toString(),
    currency: ocr.currency,
    vat_minor: ocr.vat_minor === null ? null : ocr.vat_minor.toString(),
    vat_rate: ocr.vat_rate,
    date: ocr.date,
    items: ocr.items.map((it) => ({
      description: it.description,
      amount_minor: it.amount_minor.toString(),
    })),
  });
}

// Quick magic-number sniff. We only need to distinguish jpeg / png /
// webp / pdf — the buffer was validated upstream on /upload so we can
// assume one of these.
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  // PDF: 25 50 44 46
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
    return "application/pdf";
  // WebP: RIFF....WEBP (52 49 46 46 ?? ?? ?? ?? 57 45 42 50)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  return null;
}

function serialiseOcrForText(ocr: {
  vendor: string;
  amount_minor: bigint;
  currency: string;
  vat_minor: bigint | null;
  date: string;
  items: ReadonlyArray<{ description: string; amount_minor: bigint }>;
}): string {
  const lines: string[] = [];
  lines.push(`vendor: ${ocr.vendor}`);
  lines.push(`date: ${ocr.date}`);
  lines.push(`total: ${ocr.amount_minor.toString()} ${ocr.currency} (minor)`);
  if (ocr.vat_minor !== null) {
    lines.push(`vat: ${ocr.vat_minor.toString()} (minor)`);
  }
  for (const it of ocr.items) {
    lines.push(`- ${it.description}: ${it.amount_minor.toString()} (minor)`);
  }
  return lines.join("\n");
}
