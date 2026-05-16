// POST /api/receipts/upload
//
// Multipart upload of a receipt image / PDF. The flow:
//   1. Authenticate via Better Auth (cookie).
//   2. Validate file size + MIME (jpeg/png/webp/pdf).
//   3. Pre-allocate the receipts row id app-side.
//   4. Encrypt + upload bytes to a private Vercel Blob.
//   5. Insert the row with status='pending_review', parsed_* NULL.
//
// The OCR pass happens on a separate /api/receipts/parse call so the
// upload endpoint stays fast (no model round-trip on the critical
// path). Client code typically chains upload → parse.

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import {
  uploadReceiptBlob,
  RECEIPT_MAX_BYTES,
} from "@/lib/receipts/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type Body = {
  businessId?: string;
};

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // FormData is the simplest cross-environment way to ship a file
  // through a Next route handler. Multipart parsing is built into the
  // standard Request object on Node runtime.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }

  const businessId = form.get("businessId");
  if (typeof businessId !== "string" || businessId.length === 0) {
    return Response.json({ error: "missing_business" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return Response.json(
      { error: "file_too_large", max: RECEIPT_MAX_BYTES },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: "unsupported_media_type", mimeType: file.type },
      { status: 415 },
    );
  }

  // RLS-scoped visibility check + receipt row insert. We pre-allocate the
  // receiptId so the blob path AAD binds to it.
  const receiptId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. Confirm the user can see this business (RLS will hide it from
  //    them if not). We do this BEFORE uploading bytes to avoid wasting
  //    blob storage on a forbidden request.
  const businessVisible = await withUser(user.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT 1 FROM businesses
            WHERE id = ${businessId}::uuid AND deleted_at IS NULL LIMIT 1`,
    )) as unknown as Array<unknown>;
    return rows.length === 1;
  });
  if (!businessVisible) {
    return Response.json({ error: "forbidden_business" }, { status: 403 });
  }

  // 2. Upload the encrypted blob.
  let blobUrl: string;
  let fileKeyId: string;
  try {
    const upload = await uploadReceiptBlob({
      receiptId,
      businessId,
      fileName: file.name,
      contentType: file.type,
      buffer,
    });
    blobUrl = upload.blobUrl;
    fileKeyId = upload.fileKeyId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api.receipts.upload] blob upload failed", err);
    return Response.json({ error: "blob_upload_failed" }, { status: 502 });
  }

  // 3. Insert the row. file_blob_url + file_key_id are the durable
  //    pointers; everything else stays NULL until /parse runs.
  await withUser(user.appUserId, async (tx) => {
    await tx.execute(
      sql`INSERT INTO receipts (
            id, business_id, status, source,
            file_blob_url, file_key_id
          )
          VALUES (
            ${receiptId}::uuid,
            ${businessId}::uuid,
            'pending_review'::receipt_status,
            'upload'::receipt_source,
            ${blobUrl},
            ${fileKeyId}::uuid
          )`,
    );
  });

  return Response.json({ ok: true, id: receiptId, blobUrl }, { status: 201 });
}
