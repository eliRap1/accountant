// Receipt file storage — Vercel Blob (private) + envelope encryption.
//
// Threat model: a receipt image is PII-adjacent (vendor name, line
// items, sometimes a partial PAN on a printed card slip). We treat
// every receipt blob as confidential:
//   - Upload to a Vercel Blob store with access:'private' so the URL is
//     not anonymously fetchable.
//   - Encrypt the bytes BEFORE upload with a per-business DEK (envelope
//     encryption from lib/security/dek.ts).
//   - Persist (blobUrl, fileKeyId) on the receipts row. Decryption goes
//     through `unwrapDek(fileKeyId)` — retiring the DEK
//     mathematically-erases the file even if the blob bytes linger.
//
// API surface verified 2026-05-16 against @vercel/blob@^2.3.3 docs:
//   - `put(pathname, body, { access: 'private', contentType, addRandomSuffix })`
//     returns `{ url, downloadUrl, pathname, contentType, etag }`.
//   - `get(urlOrPathname, { access: 'private' })` streams the bytes
//     back; we use it for the decrypt path.
//   - PRIVATE access requires `access: 'private'` on BOTH put and get.
//
// AAD: the receipt blob ciphertext is encrypted under the DEK with
// AAD = {table:'receipts', column:'file_blob_bytes', rowId:<receiptId>}.
// We allocate the receiptId APP-SIDE so the AAD can be computed before
// the row insert (matches the dek.ts generateDek pattern).
//
// Wire format: the encrypted blob is a single binary buffer with the
// shape `<12-byte IV><16-byte authTag><ciphertext>`. We chose binary
// over base64 so we don't 33%-bloat the storage cost.

import crypto from "node:crypto";
import { put, get } from "@vercel/blob";
import {
  getOrCreateActiveDek,
  unwrapDek,
} from "@/lib/security/dek";

// AAD constants — must match between encrypt and decrypt.
const AAD_TABLE = "receipts" as const;
const AAD_COLUMN = "file_blob_bytes" as const;

const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

// Limit: 4.5 MB Vercel server-function body limit. We stay under that
// with a 10 MB ceiling for the encrypted payload (the per-purpose DEK
// adds 28 bytes of overhead — IV + auth tag — which is negligible
// compared to image-size noise).
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024; // 4 MB raw input.

export type UploadReceiptInput = {
  /** Pre-allocated receipt row id — used in AAD + blob path. */
  receiptId: string;
  /** Business owning the receipt — drives the DEK purpose. */
  businessId: string;
  /** Original file name (logged + included as Content-Disposition hint). */
  fileName: string;
  /** MIME type. Validated by the caller, used as Content-Type. */
  contentType: string;
  /** Raw bytes — encrypted in place before upload. */
  buffer: Buffer;
};

export type UploadReceiptResult = {
  blobUrl: string;
  fileKeyId: string;
};

function aadBuffer(receiptId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      table: AAD_TABLE,
      column: AAD_COLUMN,
      rowId: receiptId,
    }),
    "utf8",
  );
}

/**
 * Encrypt `buffer` under the active DEK for `purpose` and concatenate
 * `<iv><tag><ciphertext>` into a single Buffer. The DEK plaintext is
 * zeroed before this function returns.
 */
async function encryptBytes(args: {
  purpose: string;
  receiptId: string;
  buffer: Buffer;
}): Promise<{ encrypted: Buffer; dekId: string }> {
  const { dekId, plaintext: dek } = await getOrCreateActiveDek(args.purpose);
  try {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(aadBuffer(args.receiptId));
    const ciphertext = Buffer.concat([
      cipher.update(args.buffer),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([iv, authTag, ciphertext]),
      dekId,
    };
  } finally {
    dek.fill(0);
  }
}

async function decryptBytes(args: {
  dekId: string;
  receiptId: string;
  encrypted: Buffer;
}): Promise<Buffer> {
  if (args.encrypted.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error("decryptBytes: payload too short to contain IV + tag");
  }
  const dek = await unwrapDek(args.dekId);
  try {
    const iv = args.encrypted.subarray(0, IV_LEN);
    const authTag = args.encrypted.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const ciphertext = args.encrypted.subarray(IV_LEN + AUTH_TAG_LEN);
    const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAAD(aadBuffer(args.receiptId));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}

/**
 * Per-purpose DEK string for receipt blobs. One DEK per business — when
 * a business is right-of-erasure'd we retire this DEK and every receipt
 * image becomes mathematically unrecoverable.
 */
export function dekPurposeForReceiptImage(businessId: string): string {
  return `business:${businessId}:receipt_image`;
}

/**
 * Encrypt + upload a receipt blob. The caller must have already
 * allocated the receipts row id (so AAD can be bound to it before the
 * blob exists). On any failure the function throws — callers wrap in
 * try/catch and surface a 5xx to the operator.
 */
export async function uploadReceiptBlob(
  input: UploadReceiptInput,
): Promise<UploadReceiptResult> {
  if (input.buffer.length === 0) {
    throw new Error("uploadReceiptBlob: empty buffer");
  }
  if (input.buffer.length > RECEIPT_MAX_BYTES) {
    throw new Error(
      `uploadReceiptBlob: payload exceeds ${RECEIPT_MAX_BYTES} bytes`,
    );
  }
  const purpose = dekPurposeForReceiptImage(input.businessId);
  const { encrypted, dekId } = await encryptBytes({
    purpose,
    receiptId: input.receiptId,
    buffer: input.buffer,
  });

  // Pathname namespaces by business → per-receipt. We do NOT add a
  // random suffix because the receiptId is already random; the blob URL
  // is keyed by (business, receipt) so duplicates would only occur if
  // we tried to re-upload the same row, which is a no-op error case.
  const pathname = `receipts/${input.businessId}/${input.receiptId}.bin`;
  const blob = await put(pathname, encrypted, {
    access: "private",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    // We DO NOT pass through the original input.contentType here — the
    // bytes on disk are AES-GCM ciphertext, not a JPEG/PDF. The original
    // mime is persisted on the row separately for download responses.
  });

  return {
    blobUrl: blob.url,
    fileKeyId: dekId,
  };
}

/**
 * Fetch + decrypt a receipt blob. Used by the parse route (to feed the
 * bytes to OCR) and by the future download endpoint. The caller must
 * supply the receiptId + fileKeyId persisted on the row so AAD binds
 * correctly.
 */
export async function fetchAndDecryptReceiptBlob(args: {
  blobUrl: string;
  receiptId: string;
  fileKeyId: string;
}): Promise<Buffer> {
  const blob = await get(args.blobUrl, { access: "private" });
  if (!blob || blob.stream === null) {
    throw new Error("fetchAndDecryptReceiptBlob: blob not found");
  }
  // `blob.stream` is a `ReadableStream<Uint8Array>` — collect chunks
  // into a single Buffer for the decipher.
  const reader = blob.stream.getReader();
  const chunks: Uint8Array[] = [];
  let done = false;
  while (!done) {
    const next = await reader.read();
    done = next.done;
    if (!done && next.value) chunks.push(next.value);
  }
  const encrypted = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return decryptBytes({
    dekId: args.fileKeyId,
    receiptId: args.receiptId,
    encrypted,
  });
}

// Test-only exports — the encrypt/decrypt pair is property-tested
// in tests/unit/receipts/ that don't go near @vercel/blob.
export const __testing = {
  encryptBytes,
  decryptBytes,
};
